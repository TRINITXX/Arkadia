import { describe, expect, it } from "vitest";
import { chatProgress, sinceLabel } from "@/lib/chat/chatProgress";
import {
  EMPTY_CHAT,
  type ChatItem,
  type ChatState,
  type PendingRequest,
} from "@/lib/chat/chatState";

const user = (text: string, at: number, queued = false): ChatItem => ({
  kind: "user",
  id: `u${at}`,
  text,
  images: 0,
  at,
  ...(queued ? { queued } : {}),
});
const said = (text: string, at: number): ChatItem => ({
  kind: "text",
  id: `t${at}`,
  text,
  streaming: false,
  at,
});
const turn = (at: number): ChatItem => ({
  kind: "turn",
  id: `turn${at}`,
  durationMs: 1,
  tools: 0,
  files: 0,
  at,
});
const working = (items: ChatItem[], extra: Partial<ChatState> = {}) => ({
  ...EMPTY_CHAT,
  working: true,
  turnStartedAt: 1_000,
  items,
  ...extra,
});

describe("chatProgress", () => {
  it("in a turn: since its start, Claude's latest first sentence", () => {
    const state = working([
      user("Vas-y", 1_000),
      said("Je lis le code. Puis je teste.", 2_000),
      said("**Je relance** Chrome. Ensuite le journal.", 3_000),
      user("Et la suite ?", 3_500, true),
    ]);
    expect(chatProgress(state)).toEqual({
      working: true,
      since: 1_000,
      text: "Je relance Chrome",
    });
  });

  it("in a turn with nothing said yet: « réfléchit », never the last turn's words", () => {
    const state = working([
      said("Ancien verdict", 500),
      turn(600),
      user("Vas-y", 1_000),
    ]);
    expect(chatProgress(state)?.text).toBe("réfléchit");
  });

  it("at rest: since the turn ended, the first line of the last reply", () => {
    const state: ChatState = {
      ...EMPTY_CHAT,
      items: [
        user("Vas-y", 1_000),
        said("✅ **Fini** : commit fait.\n\nDétails…", 4_000),
        turn(5_000),
      ],
    };
    expect(chatProgress(state)).toEqual({
      working: false,
      since: 5_000,
      text: "✅ Fini : commit fait",
    });
  });

  it("a ❓ round at rest waits for the user, with its question", () => {
    const reply = [
      "❓ Question 1 sur 1.",
      "",
      "On corrige d'abord la dictée ou l'envoi ?",
      "",
      "  a) La dictée",
      "  b) L'envoi",
    ].join("\n");
    const state: ChatState = {
      ...EMPTY_CHAT,
      items: [user("Vas-y", 1_000), said(reply, 2_000), turn(2_000)],
    };
    expect(chatProgress(state)?.text).toBe(
      "Attend ta réponse : On corrige d'abord la dictée ou l'envoi ?",
    );
  });

  it("an AskUserQuestion waits for the user mid-turn", () => {
    const ask = {
      requestId: "r1",
      toolName: "AskUserQuestion",
      toolUseId: "tu1",
      input: { questions: [{ question: "Quel nom ?", options: [] }] },
    } as unknown as PendingRequest;
    const state = working([user("Vas-y", 1_000)], { requests: [ask] });
    expect(chatProgress(state)).toEqual({
      working: true,
      since: 1_000,
      text: "Attend ta réponse : Quel nom ?",
    });
  });

  it("nothing for a chat that said nothing yet", () => {
    expect(chatProgress(EMPTY_CHAT)).toBeNull();
    expect(
      chatProgress({ ...EMPTY_CHAT, items: [user("Vas-y", 1_000)] }),
    ).toBeNull();
  });
});

describe("sinceLabel", () => {
  it("minutes, then hours and minutes", () => {
    expect(sinceLabel(59_000)).toBe("< 1 min");
    expect(sinceLabel(-5_000)).toBe("< 1 min");
    expect(sinceLabel(6 * 60_000 + 59_000)).toBe("6 min");
    expect(sinceLabel(80 * 60_000)).toBe("1 h 20");
    expect(sinceLabel(65 * 60_000)).toBe("1 h 05");
    expect(sinceLabel(120 * 60_000)).toBe("2 h");
  });
});
