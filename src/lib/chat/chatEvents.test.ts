import { describe, expect, it, vi } from "vitest";

/** The chat servers' lines, as Rust relays them (`chat-event`). */
let relay: ((e: { payload: string }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, cb: (e: { payload: string }) => void) => {
    relay = cb;
    return Promise.resolve(() => {});
  },
}));
/** The commands sent to the chat servers (`chat_command`). */
const sent: { type: string; taskId?: string }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args?: { command?: { type: string } }) => {
    if (name === "chat_command" && args?.command) sent.push(args.command);
    return Promise.resolve();
  },
}));

const {
  chatActivity,
  chatCommand,
  chatEventsReady,
  liveServerAccounts,
  stopAndCloseChat,
} = await import("@/lib/chat/chatEvents");

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

describe("a chat closed at work (stopAndCloseChat)", () => {
  it("stops its shells, never its subagents: stopped by id, they are never resumed", async () => {
    // Its waits run on the page's timers.
    vi.stubGlobal("window", globalThis);
    vi.useFakeTimers();
    try {
      await chatEventsReady();
      const chatId = "moved";
      await chatCommand(undefined, { type: "start", chatId, cwd: "C:/p" });
      const started = (task_id: string, task_type: string) =>
        relay?.({
          payload: JSON.stringify({
            type: "sdk",
            chatId,
            message: {
              type: "system",
              subtype: "task_started",
              task_id,
              task_type,
            },
          }),
        });
      started("agent1", "local_agent");
      started("flow1", "local_workflow");
      started("shell1", "local_bash");
      sent.length = 0;
      let closed = false;
      void stopAndCloseChat(undefined, chatId, []).then(() => {
        closed = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.map((c) => c.type)).toContain("close");
      // Claude Code marks an agent stopped by id `stoppedByUser`: SendMessage
      // then refuses it in the resumed session (12/11/2026).
      expect(sent.filter((c) => c.type === "stop_task")).toEqual([
        { type: "stop_task", chatId, taskId: "shell1" },
      ]);
      expect(sent.map((c) => c.type)).toContain("interrupt");
      // The server's `closed` says its Claude Code is gone (`closedDelayMs`).
      await vi.advanceTimersByTimeAsync(8_000);
      expect(closed).toBe(false);
      relay?.({ payload: JSON.stringify({ type: "closed", chatId }) });
      await vi.advanceTimersByTimeAsync(600);
      expect(closed).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
