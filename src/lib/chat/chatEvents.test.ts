import { describe, expect, it, vi } from "vitest";

/** The chat servers' lines, as Rust relays them (`chat-event`). */
let relay: ((e: { payload: string }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, cb: (e: { payload: string }) => void) => {
    relay = cb;
    return Promise.resolve(() => {});
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve() }));

const { chatActivity, chatCommand, chatEventsReady, liveServerAccounts } =
  await import("@/lib/chat/chatEvents");

describe("the chat servers running (chatEvents)", () => {
  it("lists a server once a chat started there, never after it stopped", async () => {
    await chatEventsReady();
    await chatCommand(undefined, { type: "start", chatId: "a", cwd: "C:/p" });
    await chatCommand("acc2", { type: "start", chatId: "b", cwd: "C:/p" });
    expect(liveServerAccounts()).toEqual([undefined, "acc2"]);
    relay?.({
      payload: JSON.stringify({ type: "server_exit", account: "acc2" }),
    });
    // A command there would start it again for nothing (the sleep delay).
    expect(liveServerAccounts()).toEqual([undefined]);
  });
});

describe("a chat started again (chatEvents)", () => {
  it("starts at rest: nothing of its last Claude Code still counts", async () => {
    await chatEventsReady();
    const chatId = "restarted";
    await chatCommand(undefined, { type: "start", chatId, cwd: "C:/p" });
    relay?.({
      payload: JSON.stringify({
        type: "bash",
        chatId,
        id: "b1",
        command: "sleep 9",
        state: "running",
      }),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(chatActivity(chatId).bangs).toEqual(["b1"]);
    // « Reprendre »: a new Chat, no `attached` before its events.
    await chatCommand(undefined, { type: "start", chatId, cwd: "C:/p" });
    expect(chatActivity(chatId).bangs).toEqual([]);
  });
});
