import { describe, expect, it } from "vitest";
import { handoffBlock } from "@chat-server/handoff";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat, type ChatState } from "@/lib/chat/chatState";

const run = (events: ChatEvent[]): ChatState =>
  events.reduce((s, e, i) => reduceChat(s, e, i + 1), EMPTY_CHAT);

const info = { from: "old", before: 512_000, summary: "## But\n- le prix" };

describe("a handoff in the column (chatHandoff)", () => {
  it("shows the separator while Opus writes, then fills it in place", () => {
    const id = "handoff:u1";
    const running = run([
      { type: "handoff", chatId: "c", id, phase: "running", before: 512_000 },
    ]);
    expect(running.items).toMatchObject([
      {
        kind: "notice",
        id,
        text: "Passation en cours…",
        handoff: { phase: "running" },
      },
    ]);
    const done = reduceChat(
      running,
      {
        type: "handoff",
        chatId: "c",
        id,
        phase: "done",
        after: 9_000,
        ...info,
      },
      5,
    );
    expect(done.items).toHaveLength(1);
    expect(done.items[0]).toMatchObject({
      text: "Nouvelle conversation · passation de 9 k",
      handoff: { phase: "done", from: "old", summary: info.summary },
    });
  });

  it("turns into a warning without a separator when it failed", () => {
    const id = "handoff:u1";
    const state = run([
      { type: "handoff", chatId: "c", id, phase: "running", before: 512_000 },
      {
        type: "handoff",
        chatId: "c",
        id,
        phase: "failed",
        error: "pas de réponse d'Opus",
      },
    ]);
    expect(state.items[0]).toMatchObject({
      tone: "warning",
      text: expect.stringContaining("reprend en entier"),
    });
    expect(state.items[0]).not.toHaveProperty("handoff");
  });

  it("reads the separator back from a session that started from a handoff", () => {
    const block = handoffBlock(info, "C:/old.jsonl", "C:/transcript.ts");
    const state = reduceChat(
      EMPTY_CHAT,
      {
        type: "history",
        chatId: "c",
        truncated: false,
        messages: [
          {
            type: "user",
            uuid: "u1",
            message: {
              role: "user",
              content: [
                { type: "text", text: block },
                { type: "text", text: "On attaque l'export" },
              ],
            },
          },
        ],
      } as ChatEvent,
      1,
    );
    expect(state.items.map((i) => i.kind)).toEqual(["notice", "user"]);
    expect(state.items[0]).toMatchObject({
      handoff: { phase: "done", from: "old", before: 512_000 },
    });
    expect(state.items[1]).toMatchObject({ text: "On attaque l'export" });
  });
});
