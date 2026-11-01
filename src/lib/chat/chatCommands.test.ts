import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import {
  EMPTY_CHAT,
  hasQueued,
  reduceChat,
  type ChatState,
} from "@/lib/chat/chatState";

/**
 * A real chat-server run (`chat-server/fixtures/slash.jsonl`): a turn,
 * /context, /compact, a turn, /rename, a /rewind relaunch before the second
 * turn, a turn, then /clear.
 */
const events = readFileSync(
  path.resolve(__dirname, "../../../chat-server/fixtures/slash.jsonl"),
  "utf-8",
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as ChatEvent);

function replay(until?: (e: ChatEvent, i: number) => boolean): ChatState {
  let state = EMPTY_CHAT;
  for (const [i, event] of events.entries()) {
    state = reduceChat(state, event, 1_000 + i);
    if (until?.(event, i)) break;
  }
  return state;
}

const resultAfter = (text: string) => {
  const sent = events.findIndex(
    (e) => e.type === "user_sent" && e.text === text,
  );
  return (e: ChatEvent, i: number) =>
    i > sent && e.type === "sdk" && e.message.type === "result";
};

const texts = (state: ChatState) =>
  state.items.flatMap((i) => (i.kind === "text" ? [i.text] : []));

describe("slash commands in the column", () => {
  it("shows a local command's answer in its card, not as Claude's words", () => {
    const state = replay(resultAfter("/context"));
    const card = [...state.items].reverse().find((i) => i.kind === "command");
    expect(card).toMatchObject({ kind: "command", name: "context" });
    expect(card?.kind === "command" && card.output).toMatch(
      /^## Context Usage/,
    );
    expect(texts(state).some((t) => t.includes("Context Usage"))).toBe(false);
  });

  it("marks /compact, hides its summary, and shows no answer twice", () => {
    const state = replay(resultAfter("/compact"));
    expect(
      state.items.some(
        (i) =>
          i.kind === "notice" &&
          /^Conversation compactée · \d+ k → \d+ k tokens$/.test(i.text),
      ),
    ).toBe(true);
    expect(
      state.items.some(
        (i) =>
          i.kind === "user" &&
          i.text.includes("This session is being continued"),
      ),
    ).toBe(false);
    expect(texts(state).some((t) => t.includes("Context Usage"))).toBe(false);
    expect(state.items.filter((i) => i.kind === "command")).toHaveLength(2);
  });

  it("takes /rename's title and the model the context report gives", () => {
    const state = replay(resultAfter("/rename slash-live"));
    expect(state.title).toBe("slash-live");
    expect(state.model).toBe("claude-haiku-5-5");
  });

  it("shows a rewound session's past: the compaction and its commands", () => {
    const state = replay((e) => e.type === "history");
    const kinds = state.items.map((i) =>
      i.kind === "command"
        ? `/${i.name}`
        : i.kind === "notice"
          ? i.text
          : i.kind,
    );
    expect(kinds).toEqual(["Conversation compactée", "/context", "/compact"]);
    const compact = state.items[2];
    expect(compact.kind === "command" && compact.output).toBe("Compacted");
  });

  it("starts the column over on /clear, on the new session, title kept", () => {
    const before = replay(resultAfter("/compact")).sessionId;
    const state = replay();
    expect(state.items[0]).toMatchObject({
      kind: "notice",
      text: "Nouvelle conversation",
    });
    expect(
      state.items.some((i) => i.kind === "user" || i.kind === "text"),
    ).toBe(false);
    expect(state.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.sessionId).not.toBe(before);
    expect(state.title).toBe("slash-live");
  });

  it("says in French where a refused command lives", () => {
    let state: ChatState = { ...EMPTY_CHAT, slashCommands: ["doctor"] };
    const sdk = (message: Record<string, unknown>): ChatEvent => ({
      type: "sdk",
      chatId: "c",
      message,
    });
    for (const event of [
      { type: "user_sent", chatId: "c", text: "/doctor", images: 0 },
      sdk({
        type: "assistant",
        uuid: "a1",
        message: {
          content: [
            {
              type: "text",
              text: "/doctor isn't available in this environment.",
            },
          ],
        },
      }),
      sdk({ type: "result", subtype: "success", num_turns: 0, result: "" }),
    ] as ChatEvent[]) {
      state = reduceChat(state, event, 1);
    }
    expect(state.items[0]).toMatchObject({
      kind: "notice",
      text: "/doctor n'existe que dans le terminal : bouton Terminal en haut à droite",
    });
    expect(texts(state)).toEqual([]);
  });

  const sdk = (message: Record<string, unknown>): ChatEvent => ({
    type: "sdk",
    chatId: "c",
    message,
  });
  const run = (state: ChatState, events: ChatEvent[]) =>
    events.reduce((s, e, i) => reduceChat(s, e, 10 + i), state);
  const working: ChatState = {
    ...EMPTY_CHAT,
    slashCommands: ["compact"],
    working: true,
  };
  const card = (state: ChatState) =>
    state.items.find((i) => i.kind === "command");

  it("makes a command sent mid-turn wait like a message, taken or not sent", () => {
    const sent = run(working, [
      {
        type: "user_sent",
        chatId: "c",
        text: "/compact",
        images: 0,
        uuid: "u1",
      },
    ]);
    expect(card(sent)).toMatchObject({ queued: true });
    expect(hasQueued(sent.items)).toBe(true);
    const taken = run(sent, [
      sdk({ type: "command_lifecycle", command_uuid: "u1", state: "started" }),
    ]);
    expect(card(taken)).toMatchObject({ queued: false });
    const lost = run(sent, [{ type: "closed", chatId: "c" }]);
    expect(card(lost)).toMatchObject({ queued: false, dropped: true });
  });

  it("leaves Claude the words of the turn a command waited for", () => {
    const state = run(working, [
      {
        type: "user_sent",
        chatId: "c",
        text: "/compact",
        images: 0,
        uuid: "u1",
      },
      sdk({
        type: "assistant",
        uuid: "a1",
        message: { content: [{ type: "text", text: "La réponse du tour" }] },
      }),
      sdk({ type: "result", subtype: "success", num_turns: 1 }),
      sdk({ type: "command_lifecycle", command_uuid: "u1", state: "started" }),
      sdk({ type: "result", subtype: "success", num_turns: 0, result: "" }),
    ]);
    expect(texts(state)).toEqual(["La réponse du tour"]);
    expect(card(state)).toMatchObject({ output: "" });
  });

  it("gives two queued commands each their own answer", () => {
    const answer = (uuid: string, command: string, text: string) =>
      sdk({
        type: "assistant",
        uuid,
        local_command_run: { command, args: "" },
        message: { content: [{ type: "text", text }] },
      });
    const state = run({ ...working, slashCommands: ["context", "cost"] }, [
      {
        type: "user_sent",
        chatId: "c",
        text: "/context",
        images: 0,
        uuid: "u1",
      },
      { type: "user_sent", chatId: "c", text: "/cost", images: 0, uuid: "u2" },
      sdk({ type: "result", subtype: "success", num_turns: 1 }),
      sdk({ type: "command_lifecycle", command_uuid: "u1", state: "started" }),
      answer("a1", "context", "Contexte : 5 %"),
      sdk({ type: "result", subtype: "success", num_turns: 0 }),
      sdk({ type: "command_lifecycle", command_uuid: "u2", state: "started" }),
      answer("a2", "cost", "Coût : 0 $"),
      sdk({ type: "result", subtype: "success", num_turns: 0 }),
    ]);
    const cards = state.items.flatMap((i) =>
      i.kind === "command" ? [[i.name, i.output]] : [],
    );
    expect(cards).toEqual([
      ["context", "Contexte : 5 %"],
      ["cost", "Coût : 0 $"],
    ]);
  });

  it("shows the server's own notice (files restored)", () => {
    const state = run(EMPTY_CHAT, [
      {
        type: "notice",
        chatId: "c",
        text: "Code remis comme avant ce message : 2 fichiers",
        tone: "info",
      },
    ]);
    expect(state.items[0]).toMatchObject({
      kind: "notice",
      text: "Code remis comme avant ce message : 2 fichiers",
    });
  });
});
