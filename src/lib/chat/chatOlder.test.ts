import { describe, expect, it } from "vitest";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat } from "@/lib/chat/chatState";

const user = (uuid: string, text: string): JsonObject => ({
  type: "user",
  uuid,
  message: { role: "user", content: text },
});
const reply = (uuid: string, text: string): JsonObject => ({
  type: "assistant",
  uuid,
  message: { id: `m-${uuid}`, content: [{ type: "text", text }] },
});
const history = (
  messages: JsonObject[],
  truncated: boolean,
  older?: boolean,
): ChatEvent => ({ type: "history", chatId: "c", messages, truncated, older });

describe("older messages of a resumed chat", () => {
  it("go on top, the cursor moving back, nothing twice", () => {
    let state = reduceChat(
      EMPTY_CHAT,
      history([user("u3", "trois"), reply("a3", "ok 3")], true),
      0,
    );
    expect(state.historyCursor).toBe("u3");
    state = reduceChat(
      state,
      { type: "user_sent", chatId: "c", text: "quatre", images: 0, uuid: "x" },
      1,
    );
    state = reduceChat(
      state,
      history(
        [user("u2", "deux"), reply("a2", "ok 2"), user("u3", "trois")],
        false,
        true,
      ),
      2,
    );
    expect(
      state.items.map((i) =>
        i.kind === "user" || i.kind === "text" ? i.text : i.kind,
      ),
    ).toEqual(["deux", "ok 2", "trois", "ok 3", "quatre"]);
    expect(state.historyCursor).toBe("u2");
    expect(state.historyTruncated).toBe(false);
  });

  it("links a call to its result across the page boundary", () => {
    const call = (uuid: string, id: string): JsonObject => ({
      type: "assistant",
      uuid,
      message: {
        id: `m-${uuid}`,
        content: [{ type: "tool_use", id, name: "Bash", input: {} }],
      },
    });
    const result = (uuid: string, id: string): JsonObject => ({
      type: "user",
      uuid,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: "fait" }],
      },
    });
    // The page shown starts with the result of a call it doesn't hold.
    let state = reduceChat(
      EMPTY_CHAT,
      history([result("r1", "t1"), reply("a1", "ok"), call("c2", "t2")], true),
      0,
    );
    const tool = (id: string) =>
      state.items.find((i) => i.kind === "tool" && i.id === id) as
        | Extract<(typeof state.items)[number], { kind: "tool" }>
        | undefined;
    // A past call whose result never came is not running.
    expect(tool("t2")).toMatchObject({ stale: true, result: undefined });
    state = reduceChat(
      state,
      history([user("u0", "lance"), call("c1", "t1")], false, true),
      1,
    );
    expect(tool("t1")?.result?.text).toBe("fait");
    expect(tool("t1")?.stale).toBeUndefined();
    expect(state.historyOrphans).toEqual([]);
  });

  it("says when a compaction left nothing older to load", () => {
    let state = reduceChat(EMPTY_CHAT, history([user("u3", "trois")], true), 0);
    state = reduceChat(
      state,
      { ...history([], false, true), unreachable: true } as ChatEvent,
      1,
    );
    expect(state.historyTruncated).toBe(false);
    expect(state.items[0]).toMatchObject({
      kind: "notice",
      text: "Les messages d'avant la compaction ne se rechargent pas ici",
    });
  });

  it("knows no session after /clear until the next init", () => {
    const sdk = (message: JsonObject): ChatEvent => ({
      type: "sdk",
      chatId: "c",
      message,
    });
    let state = reduceChat(
      EMPTY_CHAT,
      sdk({ type: "system", subtype: "init", session_id: "old" }),
      0,
    );
    state = reduceChat(
      state,
      sdk({ type: "conversation_reset", new_conversation_id: "not-it" }),
      1,
    );
    expect(state.sessionId).toBeNull();
    state = reduceChat(
      state,
      sdk({ type: "system", subtype: "init", session_id: "new" }),
      2,
    );
    expect(state.sessionId).toBe("new");
  });

  it("shows the starting mode until the first turn says it", () => {
    let state = reduceChat(
      EMPTY_CHAT,
      { type: "info", chatId: "c", mode: "auto" },
      0,
    );
    expect(state.mode).toBe("auto");
    state = reduceChat(
      state,
      {
        type: "sdk",
        chatId: "c",
        message: { type: "system", subtype: "init", permissionMode: "plan" },
      },
      1,
    );
    state = reduceChat(state, { type: "info", chatId: "c", mode: "auto" }, 2);
    expect(state.mode).toBe("plan");
  });
});
