import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import {
  foldPhoneChat,
  NEW_PHONE_CHAT,
  phoneChatReadable,
  phoneServerExit,
} from "@/lib/chat/phoneChatFold";

const sent = (text: string): ChatEvent => ({
  type: "user_sent",
  chatId: "c",
  text,
  images: 0,
});
const texts = (items: { kind: string; text?: string }[]) =>
  items.filter((i) => i.kind === "user").map((i) => i.text);

describe("foldPhoneChat", () => {
  it("builds a replay apart and shows it whole at its end", () => {
    // Live events heard before the phone's replay: the replay holds them too.
    let { chat } = foldPhoneChat(NEW_PHONE_CHAT, [sent("a")], 0);
    ({ chat } = foldPhoneChat(
      chat,
      [{ type: "attached", chatId: "c" }, sent("a")],
      0,
    ));
    expect(texts(chat.state.items)).toEqual(["a"]);
    expect(chat.replay).not.toBeNull();
    ({ chat } = foldPhoneChat(
      chat,
      [sent("b"), { type: "replayed", chatId: "c" }, sent("c")],
      0,
    ));
    expect(chat.replay).toBeNull();
    expect(texts(chat.state.items)).toEqual(["a", "b", "c"]);
  });

  it("asks to catch up when an ended chat speaks again", () => {
    let { chat, catchUp } = foldPhoneChat(
      NEW_PHONE_CHAT,
      [{ type: "closed", chatId: "c" }],
      0,
    );
    expect(catchUp).toBe(false);
    expect(chat.state.closed).not.toBeNull();
    ({ chat, catchUp } = foldPhoneChat(chat, [sent("again")], 0));
    expect(catchUp).toBe(true);
    // Its replay, once asked, starts it over.
    ({ chat } = foldPhoneChat(
      chat,
      [
        { type: "attached", chatId: "c" },
        sent("again"),
        { type: "replayed", chatId: "c" },
      ],
      0,
    ));
    expect(chat.state.closed).toBeNull();
    expect(texts(chat.state.items)).toEqual(["again"]);
  });

  it("keeps a subagent's conversation apart", () => {
    const { chat } = foldPhoneChat(
      NEW_PHONE_CHAT,
      [
        {
          type: "history",
          chatId: "c",
          agentId: "a1",
          messages: [],
          truncated: false,
        },
      ],
      0,
    );
    expect(Object.keys(chat.agents)).toEqual(["a1"]);
    expect(chat.state).toBe(NEW_PHONE_CHAT.state);
  });

  it("sends its own reads only to a chat running, until its replay after a server stop", () => {
    expect(phoneChatReadable(NEW_PHONE_CHAT)).toBe(true);
    // Its server stopped: nothing asked until a server replays it again.
    let chat = phoneServerExit(NEW_PHONE_CHAT);
    expect(phoneChatReadable(chat)).toBe(false);
    ({ chat } = foldPhoneChat(chat, [sent("live")], 0));
    expect(phoneChatReadable(chat)).toBe(false);
    ({ chat } = foldPhoneChat(chat, [{ type: "attached", chatId: "c" }], 0));
    expect(phoneChatReadable(chat)).toBe(true);
    // Ended or asleep: no read either.
    ({ chat } = foldPhoneChat(chat, [{ type: "closed", chatId: "c" }], 0));
    expect(phoneChatReadable(chat)).toBe(false);
    const asleep = {
      ...NEW_PHONE_CHAT,
      state: { ...NEW_PHONE_CHAT.state, asleep: true },
    };
    expect(phoneChatReadable(asleep)).toBe(false);
  });
});
