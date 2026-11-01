import { describe, expect, it } from "vitest";
import type { Account } from "@/lib/accounts";
import {
  chatLimitHit,
  nextFreeAccountAt,
  planChatLimitSwitch,
} from "@/lib/chat/chatLimit";

const NOW = 1_800_000_000_000;
const account = (
  id: string,
  pct: number,
  resetsInMin: number | null,
  loggedIn = true,
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
});
