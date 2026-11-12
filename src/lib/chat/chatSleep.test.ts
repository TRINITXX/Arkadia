import { describe, expect, it } from "vitest";
import { closedDelayMs, DEFAULT_SLEEP_MS } from "@chat-server/sleep";
import { parseSleepAfter, sleepChoiceLabel } from "@/lib/chat/chatSleep";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";
import type { ChatEvent } from "@/lib/chat/chatProtocol";

const chatId = "c";
const fold = (events: ChatEvent[], state: ChatState = EMPTY_CHAT) =>
  events.reduce((s, e) => reduceChat(s, e, 1_000), state);

describe("the chats' sleep (chatSleep)", () => {
  it("reads the stored delay back, 30 min when none or unknown", () => {
    expect(parseSleepAfter(String(15 * 60_000))).toBe(15 * 60_000);
    expect(parseSleepAfter("never")).toBeNull();
    expect(parseSleepAfter(null)).toBe(DEFAULT_SLEEP_MS);
    expect(parseSleepAfter("12345")).toBe(DEFAULT_SLEEP_MS);
  });

  it("names the choices as the settings show them", () => {
    expect([15, 30, 60].map((m) => sleepChoiceLabel(m * 60_000))).toEqual([
      "15 min",
      "30 min",
      "1 h",
    ]);
    expect(sleepChoiceLabel(null)).toBe("Jamais");
  });

  it("keeps the column and the figures as they were while asleep", () => {
    const before = fold([
      { type: "user_sent", chatId, text: "salut", images: 0, uuid: "u" },
      { type: "sdk", chatId, message: { type: "result", subtype: "success" } },
      {
        type: "context",
        chatId,
        percentage: 12,
        totalTokens: 1,
        maxTokens: 10,
      },
    ]);
    const asleep = fold([{ type: "asleep", chatId }], before);
    expect(asleep).toEqual({ ...before, asleep: true });
    expect(fold([{ type: "awake", chatId }], asleep).asleep).toBe(false);
  });

  it("counts a turn Claude starts itself from zero tokens", () => {
    const first = fold([
      { type: "user_sent", chatId, text: "x", images: 0, uuid: "u" },
      {
        type: "sdk",
        chatId,
        message: {
          type: "stream_event",
          api_message_id: "m1",
          event: { type: "message_delta", usage: { output_tokens: 500 } },
        },
      },
      { type: "sdk", chatId, message: { type: "result", subtype: "success" } },
    ]);
    expect(first.turnTokens).toBeGreaterThan(0);
    // A task's report wakes Claude: its first reply opens the next turn.
    const next = fold(
      [
        {
          type: "sdk",
          chatId,
          message: {
            type: "stream_event",
            api_message_id: "m2",
            event: { type: "message_start" },
          },
        },
      ],
      first,
    );
    expect(next.working).toBe(true);
    expect(next.turnTokens).toBe(0);
  });

  it("keeps a /rewind's cut until the server says it's gone", () => {
    const cut = fold([
      { type: "info", chatId, rewind: { before: "u7", at: "a6" } },
      { type: "info", chatId, title: "Titre" },
    ]);
    expect(cut.rewind).toEqual({ before: "u7", at: "a6" });
    expect(
      fold([{ type: "info", chatId, rewind: null }], cut).rewind,
    ).toBeNull();
  });

  it("is awake again once a message goes, and never asleep once ended", () => {
    const asleep = fold([{ type: "asleep", chatId }]);
    expect(
      fold([{ type: "user_sent", chatId, text: "x", images: 0 }], asleep)
        .asleep,
    ).toBe(false);
    expect(fold([{ type: "closed", chatId }], asleep).asleep).toBe(false);
  });
});

describe("a closed chat says so (closedDelayMs)", () => {
  it("waits past the kit kill under a subagent or a workflow, not otherwise", () => {
    expect(closedDelayMs([])).toBe(0);
    // Its Claude Code lives 7.1 s after the close (measured 12/11/2026).
    expect(closedDelayMs(["agent1"])).toBeGreaterThan(7_100);
    // The page gives up on `closed` after 10 s (`FORCED_CLOSE_WAIT_MS`).
    expect(closedDelayMs(["agent1"])).toBeLessThan(10_000);
  });
});
