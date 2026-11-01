import { describe, expect, it } from "vitest";
import { IDLE_CHAT, nextActivity } from "@/lib/chat/chatEvents";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import {
  chatBusyReason,
  chatForCommand,
  chatLabelOf,
  chatTitle,
  paneChatTitle,
  restoredChat,
  restoredLaunch,
  terminalBusyReason,
} from "@/lib/chat/usePaneChats";

const sdk = (type: string, extra: Record<string, unknown> = {}): ChatEvent => ({
  type: "sdk",
  chatId: "c",
  message: { type, ...extra },
});

describe("nextActivity", () => {
  it("is busy from the prompt to the turn's end, waiting while Claude asks", () => {
    const steps: ChatEvent[] = [
      { type: "user_sent", chatId: "c", text: "x", images: 0 },
      sdk("stream_event"),
      {
        type: "permission",
        chatId: "c",
        requestId: "r",
        toolName: "Bash",
        input: {},
        toolUseId: "t",
      },
      { type: "permission_resolved", chatId: "c", requestId: "r" },
      sdk("result"),
    ];
    const seen = [];
    let a = IDLE_CHAT;
    for (const e of steps) {
      a = nextActivity(a, e);
      seen.push(chatTitle(a, "x").charAt(0));
    }
    expect(seen).toEqual(["·", "·", "✳", "·", "✳"]);
  });

  it("stays busy while background tasks run after the turn", () => {
    let a = nextActivity(
      IDLE_CHAT,
      sdk("system", { subtype: "task_started", task_id: "t1" }),
    );
    a = nextActivity(a, sdk("result"));
    expect(chatTitle(a, "x").charAt(0)).toBe("·");
    a = nextActivity(
      a,
      sdk("system", { subtype: "task_notification", task_id: "t1" }),
    );
    expect(chatTitle(a, "x").charAt(0)).toBe("✳");
  });

  it("keeps a request still open when the turn ends", () => {
    let a = nextActivity(IDLE_CHAT, {
      type: "permission",
      chatId: "c",
      requestId: "r",
      toolName: "Bash",
      input: {},
      toolUseId: "t",
    });
    a = nextActivity(a, sdk("result"));
    expect(a.pending).toBe(1);
  });

  it("ignores a subagent's own messages and starts over on a reattach", () => {
    const busy = nextActivity(IDLE_CHAT, sdk("assistant"));
    expect(nextActivity(busy, sdk("result", { parent_tool_use_id: "t" }))).toBe(
      busy,
    );
    expect(nextActivity(busy, { type: "attached", chatId: "c" })).toEqual(
      IDLE_CHAT,
    );
  });
});

describe("background tasks", () => {
  const started = (id: string, extra: Record<string, unknown> = {}) =>
    sdk("system", { subtype: "task_started", task_id: id, ...extra });

  it("leaves Claude waiting behind a shell, as the terminal does", () => {
    let a = nextActivity(IDLE_CHAT, started("s1", { task_type: "local_bash" }));
    a = nextActivity(a, sdk("result"));
    expect(chatTitle(a, "x").charAt(0)).toBe("✳");
    expect(chatBusyReason(a, false)).toMatch(/fond/);
  });

  it("counts no ambient task, and takes the whole live list as it comes", () => {
    let a = nextActivity(IDLE_CHAT, started("w", { ambient: true }));
    expect(a).toEqual(IDLE_CHAT);
    a = nextActivity(a, started("lost"));
    a = nextActivity(
      a,
      sdk("system", {
        subtype: "background_tasks_changed",
        tasks: [{ task_id: "b1", task_type: "local_bash" }],
      }),
    );
    expect(a.tasks).toEqual([]);
    expect(a.shells).toEqual(["b1"]);
  });
});

describe("nextActivity on the user's `!` commands", () => {
  it("counts a command until Claude Code wrote its entries", () => {
    const running = nextActivity(IDLE_CHAT, {
      type: "bash",
      chatId: "c",
      id: "b1",
      command: "pnpm test",
      state: "running",
    });
    expect(running.bangs).toEqual(["b1"]);
    // A message sent meanwhile waits in the server: no turn yet.
    const held = nextActivity(running, {
      type: "user_sent",
      chatId: "c",
      text: "x",
      images: 0,
      uuid: "m",
    });
    expect(held.busy).toBe(false);
    const ended = nextActivity(held, {
      type: "bash",
      chatId: "c",
      id: "b1",
      command: "pnpm test",
      state: "done",
    });
    // Until the server says its entries written: it alone judges.
    expect(ended.bangs).toEqual(["b1"]);
    const written = nextActivity(ended, {
      type: "bash_written",
      chatId: "c",
      id: "b1",
    });
    expect(written.bangs).toEqual([]);
    expect(chatBusyReason(ended, false)).toMatch(/commande ! tourne/);
    expect(chatBusyReason(written, false)).toBeNull();
  });

  it("is busy once Claude Code takes what waited behind a command, never for its entries", () => {
    const start: ChatEvent = {
      type: "bash",
      chatId: "c",
      id: "b1",
      command: "pnpm build",
      state: "running",
    };
    const held = nextActivity(nextActivity(IDLE_CHAT, start), {
      type: "user_sent",
      chatId: "c",
      text: "/compact",
      images: 0,
      uuid: "c1",
    });
    expect(held.busy).toBe(false);
    // A `!` entry taken: its result is swallowed, `busy` would stick.
    const entry = nextActivity(
      held,
      sdk("command_lifecycle", { command_uuid: "e1", state: "started" }),
    );
    expect(entry.busy).toBe(false);
    const taken = nextActivity(
      entry,
      sdk("command_lifecycle", { command_uuid: "c1", state: "started" }),
    );
    expect(taken).toMatchObject({ busy: true, held: [] });
    expect(chatBusyReason({ ...taken, bangs: [] }, false)).toMatch(/travaille/);
  });

  it("counts nothing of a command whose chat ended before it", () => {
    const closed = nextActivity(
      nextActivity(IDLE_CHAT, {
        type: "bash",
        chatId: "c",
        id: "b1",
        command: "sleep 9",
        state: "running",
      }),
      { type: "closed", chatId: "c", error: "gone" },
    );
    // Its end arrives after the `closed`: no entries to wait for.
    const late = nextActivity(closed, {
      type: "bash",
      chatId: "c",
      id: "b1",
      command: "sleep 9",
      state: "done",
    });
    expect(late.bangs).toEqual([]);
  });
});

describe("chatBusyReason", () => {
  it("lets a chat go to the terminal only at rest, and not mid-replay", () => {
    expect(chatBusyReason(IDLE_CHAT, false)).toBeNull();
    expect(chatBusyReason(IDLE_CHAT, true)).toMatch(/recharge/);
    expect(chatBusyReason({ ...IDLE_CHAT, busy: true }, false)).toMatch(
      /travaille/,
    );
    expect(chatBusyReason({ ...IDLE_CHAT, pending: 1 }, false)).toMatch(
      /Réponds/,
    );
  });
});

describe("chatLabelOf", () => {
  it("reads back the label of a chat title, and only of one", () => {
    expect(chatLabelOf(chatTitle(IDLE_CHAT, "Refonte"))).toBe("Refonte");
    expect(chatLabelOf("C:/Users/x")).toBeNull();
  });
});

describe("terminalBusyReason", () => {
  const waiting = { kind: "waiting" as const, session_id: "s" };
  it("lets only a Claude resting at its plain prompt leave for the chat", () => {
    expect(terminalBusyReason(waiting, true)).toBeNull();
    expect(terminalBusyReason({ kind: "busy" }, true)).toMatch(/travaille/);
    expect(
      terminalBusyReason({ ...waiting, shellRunning: true }, true),
    ).toMatch(/fond/);
    // A menu on screen (question, plan, permission): /exit's Enter would answer it.
    expect(terminalBusyReason(waiting, false)).toMatch(/Réponds/);
  });
});

describe("chatForCommand", () => {
  it("opens Claude's toolbar commands as a chat, and only those", () => {
    expect(chatForCommand("ccd", "C:/p")).toEqual({ cwd: "C:/p" });
    expect(chatForCommand("ccdr", "C:/p")).toEqual({
      cwd: "C:/p",
      continue: true,
    });
    expect(
      chatForCommand(
        "ccd --resume 0f3a2b1c-1111-2222-3333-444455556666",
        "C:/p",
      ),
    ).toEqual({ cwd: "C:/p", resume: "0f3a2b1c-1111-2222-3333-444455556666" });
    expect(chatForCommand("npm run dev", "C:/p")).toBeNull();
    expect(chatForCommand("ccu", "C:/p")).toBeNull();
  });
});

describe("restoredChat", () => {
  it("reopens a chat on its own session only, never a pane map's", () => {
    const resume = "0f3a2b1c-1111-2222-3333-444455556666";
    expect(restoredChat({ cwd: "C:/p", resume })).toEqual({
      cwd: "C:/p",
      resume,
    });
    expect(restoredChat({ cwd: "C:/p", continue: true })).toEqual({
      cwd: "C:/p",
      continue: true,
    });
    // After /clear: no session of its own, a fresh chat.
    expect(restoredChat({ cwd: "C:/p" })).toEqual({ cwd: "C:/p" });
    // Opened asleep and never typed in: asleep again, nothing started.
    expect(restoredChat({ cwd: "C:/p", asleep: true })).toEqual({
      cwd: "C:/p",
      asleep: true,
    });
    // Woken, it has a session: it goes on with it.
    expect(restoredChat({ cwd: "C:/p", resume, asleep: true })).toEqual({
      cwd: "C:/p",
      resume,
    });
  });
});

describe("restoredLaunch", () => {
  it("never reopens one session twice in a restore", () => {
    const x = "0f3a2b1c-1111-2222-3333-444455556666";
    const taken = new Set<string>();
    // A terminal on X, then a chat on X (two snapshots merged): the chat
    // reopens asleep, off X, with its draft.
    expect(restoredLaunch(undefined, x, taken)).toEqual({
      init: `ccd --resume ${x}`,
    });
    expect(restoredLaunch({ cwd: "C:/p", resume: x }, null, taken)).toEqual({
      chat: { cwd: "C:/p", asleep: true },
    });
    // And a chat first leaves the terminal a bare shell.
    const first = new Set<string>();
    expect(restoredLaunch({ cwd: "C:/p", resume: x }, null, first)).toEqual({
      chat: { cwd: "C:/p", resume: x },
    });
    expect(restoredLaunch(undefined, x, first)).toEqual({});
    // Without a session, nothing to collide on: a fresh Claude each time.
    expect(restoredLaunch(undefined, null, first)).toEqual({ init: "ccd" });
    expect(restoredLaunch({ cwd: "C:/p" }, null, first)).toEqual({
      chat: { cwd: "C:/p" },
    });
  });
});

describe("a chat pane's title", () => {
  it("has no badge while the chat was never started", () => {
    expect(paneChatTitle({ cwd: "C:/p", asleep: true }, IDLE_CHAT, "p")).toBe(
      "p",
    );
    expect(paneChatTitle({ cwd: "C:/p" }, IDLE_CHAT, "p")).toBe(
      chatTitle(IDLE_CHAT, "p"),
    );
  });
});
