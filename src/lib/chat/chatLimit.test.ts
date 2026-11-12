import { describe, expect, it } from "vitest";
import type { Account } from "@/lib/accounts";
import {
  chatLimitHit,
  modelLimitUntil,
  nextFreeAccountAt,
  planChatLimitSwitch,
} from "@/lib/chat/chatLimit";

const NOW = 1_800_000_000_000;
const account = (
  id: string,
  pct: number,
  resetsInMin: number | null,
  loggedIn = true,
  fablePct?: number,
): Account => ({
  id,
  label: id,
  customLabel: false,
  color: "#fff",
  email: null,
  plan: null,
  loggedIn,
  stale: false,
  usage: {
    fiveHour: {
      pct,
      resetsAt: resetsInMin === null ? null : NOW / 1000 + resetsInMin * 60,
    },
    ...(fablePct === undefined
      ? {}
      : {
          models: [
            { model: "Fable", pct: fablePct, resetsAt: NOW / 1000 + 86_400 },
          ],
        }),
    updatedAt: NOW,
    source: "test",
  },
});

describe("a chat at its usage limit", () => {
  it("sees the limit refuse its own turn only", () => {
    const rejected = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1_900_000_000 },
    };
    expect(chatLimitHit(rejected)).toEqual({ resetsAt: 1_900_000_000 });
    expect(
      chatLimitHit({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed_warning" },
      }),
    ).toBeNull();
    expect(
      chatLimitHit({
        ...rejected,
        rate_limit_info: { status: "rejected", isUsingOverage: true },
      }),
    ).toBeNull();
    expect(chatLimitHit({ type: "assistant", error: "rate_limit" })).toEqual(
      {},
    );
    expect(
      chatLimitHit({
        type: "assistant",
        error: "rate_limit",
        parent_tool_use_id: "agent",
      }),
    ).toBeNull();
  });

  it("moves to the free account whose quota resets soonest", () => {
    const accounts = [
      account("main", 100, 30),
      account("b", 20, 240),
      account("c", 80, 45),
      account("d", 0, null),
      account("e", 10, 5, false),
    ];
    expect(planChatLimitSwitch(accounts, {}, "main", NOW)).toEqual({
      kind: "switch",
      accountId: "c",
    });
    expect(
      planChatLimitSwitch(accounts, { c: NOW + 60_000 }, "main", NOW),
    ).toEqual({ kind: "switch", accountId: "b" });
    expect(
      planChatLimitSwitch(
        accounts,
        { b: NOW + 1, c: NOW + 1, d: NOW + 1 },
        "main",
        NOW,
      ),
    ).toEqual({ kind: "none" });
  });

  it("with none free, waits for the first other account back", () => {
    // The report of 01/11/2026: the chat's account and one other blocked,
    // the third back at 07:20, the chat never moved.
    const accounts = [
      account("main", 100, 60),
      account("b", 100, 16),
      account("c", 100, 216),
      account("d", 0, null, false),
    ];
    const blocked = { b: NOW + 16 * 60_000, c: NOW + 216 * 60_000 };
    expect(nextFreeAccountAt(accounts, blocked, "main", NOW)).toBe(
      NOW + 16 * 60_000,
    );
    expect(
      nextFreeAccountAt(accounts, blocked, "main", NOW + 20 * 60_000),
    ).toBe(NOW + 216 * 60_000);
    expect(nextFreeAccountAt([account("main", 100, 60)], {}, "main", NOW)).toBe(
      null,
    );
  });

  it("tells one model's limit from the account's", () => {
    // The refusal of 12/11/2026 on account 3, then the reply it replaced.
    expect(
      chatLimitHit({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          resetsAt: 1_794_726_000,
          rateLimitType: "seven_day_overage_included",
          overageStatus: "rejected",
          isUsingOverage: false,
        },
      }),
    ).toEqual({ resetsAt: 1_794_726_000, scope: "model" });
    expect(
      chatLimitHit({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "seven_day_opus",
        },
      }),
    ).toEqual({ scope: "model", family: "opus" });
    expect(
      chatLimitHit({
        type: "assistant",
        error: "rate_limit",
        message: {
          content: [
            {
              type: "text",
              text: "You've reached your Fable limit. Switch to another model, or manage usage credits",
            },
          ],
        },
      }),
    ).toEqual({ scope: "model", family: "fable" });
    expect(
      chatLimitHit({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
      }),
    ).toEqual({});
  });

  it("lifts a model's limit at the account's 5-hour reset, not the refusal's date", () => {
    // Said Sunday, Fable back at 04:10 with the 5-hour window.
    const sunday = NOW / 1000 + 3 * 86_400;
    expect(modelLimitUntil(sunday, account("c", 100, 60), NOW)).toBe(
      NOW + 61 * 60_000,
    );
    // The reset not known: one 5-hour window at most, still not Sunday.
    expect(modelLimitUntil(sunday, account("c", 0, null), NOW)).toBe(
      NOW + 5 * 3600_000 + 60_000,
    );
  });

  it("keeps Fable on an account free for it, else goes on in Opus", () => {
    // 12/11/2026 at 13:06: accounts 1 and 2 at 100 %, account 3 at 29 %.
    const accounts = [
      account("main", 100, 60),
      account("b", 100, 80),
      account("c", 29, 10),
    ];
    const full = { main: NOW + 61 * 60_000 };
    expect(planChatLimitSwitch(accounts, full, "main", NOW, "fable")).toEqual({
      kind: "switch",
      accountId: "c",
    });
    // Fable out on account 3 (a refusal, or its share used up): Opus there.
    const fableOut = { ...full, "c:fable": NOW + 10 * 60_000 };
    expect(
      planChatLimitSwitch(accounts, fableOut, "main", NOW, "fable"),
    ).toEqual({ kind: "switch", accountId: "c", model: "opus" });
    const shareUsed = [
      account("main", 100, 60),
      account("c", 29, 10, true, 100),
    ];
    expect(planChatLimitSwitch(shareUsed, full, "main", NOW, "fable")).toEqual({
      kind: "switch",
      accountId: "c",
      model: "opus",
    });
    // Its own account's Fable out, no other free: Opus where it is.
    expect(
      planChatLimitSwitch(
        accounts,
        { main: NOW + 1, b: NOW + 1, "c:fable": NOW + 1 },
        "c",
        NOW,
        "fable",
      ),
    ).toEqual({ kind: "switch", accountId: "c", model: "opus" });
    // A model not known: any model's block counts.
    expect(planChatLimitSwitch(accounts, fableOut, "main", NOW)).toEqual({
      kind: "none",
    });
    // Opus out everywhere waits: no fall to Sonnet unasked.
    expect(
      planChatLimitSwitch(
        accounts,
        { main: NOW + 1, b: NOW + 1, "c:opus": NOW + 1 },
        "main",
        NOW,
        "opus",
      ),
    ).toEqual({ kind: "none" });
  });
});
