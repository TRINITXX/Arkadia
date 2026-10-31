import { describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@/lib/chat/chatProtocol";

/** The chat servers' lines, as Rust relays them (`chat-event`). */
let relay: ((e: { payload: string }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, cb: (e: { payload: string }) => void) => {
    relay = cb;
    return Promise.resolve(() => {});
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve() }));

const { chatCommand, chatEventsReady } = await import("@/lib/chat/chatEvents");
const { watchChatNotify } = await import("@/lib/chat/useChatNotify");

const line = (event: ChatEvent | { type: "server_exit"; account: string }) =>
  relay?.({ payload: JSON.stringify(event) });

describe("watchChatNotify", () => {
  it("ends a turn its server's exit cut, and the chat restarts afresh", async () => {
    await chatEventsReady();
    const signals: string[] = [];
    const off = watchChatNotify(
      (chatId, s) => signals.push(`${chatId}:${s.kind}:${s.selfWoken}`),
      () => {},
    );
    const chatId = "server-gone";
    const ended = {
      type: "sdk",
      chatId,
      message: { type: "result", subtype: "success", num_turns: 1 },
    } as const;
    await chatCommand(undefined, { type: "start", chatId, cwd: "C:/p" });
    line({ type: "user_sent", chatId, text: "x", images: 0 });
    line(ended);
    // A task's report opens a turn of Claude's own, cut by the exit.
    line({
      type: "user_origin",
      chatId,
      kind: "task-notification",
      artifact: false,
      idleNotice: false,
    });
    line({ type: "sdk", chatId, message: { type: "assistant", message: {} } });
    line({ type: "server_exit", account: "main" });
    expect(signals).toEqual([`${chatId}:done:false`, `${chatId}:done:true`]);
    // Started again (no `attached`): nothing of the cut turn is left, its
    // first message opens a turn of the user's.
    line({ type: "user_sent", chatId, text: "y", images: 0, uuid: "u1" });
    line(ended);
    expect(signals[2]).toBe(`${chatId}:done:false`);
    off();
  });

  it("notifies nothing a reattach replays, then the live end after it", async () => {
    await chatEventsReady();
    const signals: string[] = [];
    const off = watchChatNotify(
      (chatId, s) => signals.push(`${chatId}:${s.kind}`),
      () => {},
    );
    const chatId = "replayed";
    // Stamped a few seconds ago: only the replay window tells it is old.
    const at = Date.now() - 5000;
    line({ type: "attached", chatId });
    line({ type: "user_sent", chatId, text: "x", images: 0, at });
    line({
      type: "sdk",
      chatId,
      at,
      message: {
        type: "assistant",
        message: { content: [{ type: "text", text: "Fait." }] },
      },
    });
    line({
      type: "sdk",
      chatId,
      at,
      message: { type: "result", subtype: "success", num_turns: 1 },
    });
    line({
      type: "permission",
      chatId,
      at,
      requestId: "r1",
      toolName: "Bash",
      input: {},
      toolUseId: "t1",
    });
    line({ type: "replayed", chatId });
    expect(signals).toEqual([]);

    // Live, for a chat no pane shows (nothing attached it): it notifies.
    line({ type: "permission_resolved", chatId, requestId: "r1" });
    line({ type: "user_sent", chatId: "hidden", text: "y", images: 0 });
    line({
      type: "sdk",
      chatId: "hidden",
      message: { type: "result", subtype: "success", num_turns: 1 },
    });
    expect(signals).toEqual(["hidden:done"]);
    off();
  });
});
