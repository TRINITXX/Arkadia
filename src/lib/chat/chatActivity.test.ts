import { describe, expect, it } from "vitest";
import { IDLE_CHAT, nextActivity } from "@/lib/chat/chatEvents";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import {
  chatBusyReason,
  chatForCommand,
  chatLabelOf,
  chatTitle,
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
