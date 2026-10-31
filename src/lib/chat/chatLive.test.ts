import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@/lib/chat/chatProtocol";

/** The chat server's events, sent by hand. */
const listeners = new Map<string, (event: ChatEvent) => void>();
vi.mock("@/lib/chat/chatEvents", () => ({
  chatCommand: () => Promise.resolve(),
  chatEventsReady: () => Promise.resolve(),
  subscribeChat: (chatId: string, cb: (event: ChatEvent) => void) => {
    listeners.set(chatId, cb);
    return () => listeners.delete(chatId);
  },
  subscribeServerExit: () => () => {},
}));

const { attachLiveChat, dropLiveChat, liveChatState } =
  await import("@/lib/chat/chatLive");
const { dropDraft, getDraft, setDraft } = await import("@/lib/chat/chatDrafts");

const SHOT = "C:\\Users\\me\\Capture d'écran 1.png";

/** A first message starts Claude's turn: the next one waits (`queued`). */
const first = (chatId: string): ChatEvent => ({
  type: "user_sent",
  chatId,
  text: "un",
  images: 0,
  uuid: "u0",
});
const ids = (chatId: string) => liveChatState(chatId).items.map((i) => i.id);

function send(chatId: string, events: ChatEvent[]): void {
  for (const event of events) listeners.get(chatId)?.(event);
  vi.runOnlyPendingTimers();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a queued message withdrawn by its ×", () => {
  it("leaves the column and goes back in the input, before what it holds", () => {
    vi.useFakeTimers();
    const chatId = "live-withdraw";
    attachLiveChat(chatId, undefined);
    setDraft(chatId, { text: "nouveau", images: [] });
    send(chatId, [
      first(chatId),
      {
        type: "user_sent",
        chatId,
        text: `corrige\n\n"${SHOT}"`,
        images: 0,
        uuid: "u1",
      },
      { type: "queued_removed", chatId, uuid: "u1" },
    ]);
    expect(ids(chatId)).toEqual(["sent:u0"]);
    expect(getDraft(chatId)).toMatchObject({
      text: "corrige\nnouveau",
      files: [{ path: SHOT }],
    });
    dropLiveChat(chatId);
    dropDraft(chatId);
  });

  it("never comes back from a reload's replay", () => {
    vi.useFakeTimers();
    const chatId = "live-replay";
    attachLiveChat(chatId, undefined);
    send(chatId, [
      { type: "attached", chatId },
      first(chatId),
      {
        type: "user_sent",
        chatId,
        text: "ancien",
        images: 0,
        uuid: "u1",
      },
      { type: "queued_removed", chatId, uuid: "u1" },
      { type: "replayed", chatId },
    ]);
    expect(ids(chatId)).toEqual(["sent:u0"]);
    expect(getDraft(chatId).text).toBe("");
    dropLiveChat(chatId);
  });
});
