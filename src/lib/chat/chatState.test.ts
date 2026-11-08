import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import {
  EMPTY_CHAT,
  latestPlan,
  liveWindow,
  reduceChat,
  tasksOf,
  visibleUserText,
  type ChatState,
} from "@/lib/chat/chatState";

/** Real chat-server runs, recorded by `chat-server/record.ts`. */
function fixture(name: string): ChatEvent[] {
  const file = path.resolve(
    __dirname,
    "../../../chat-server/fixtures",
    `${name}.jsonl`,
  );
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatEvent);
}

function replay(
  events: ChatEvent[],
  until?: (e: ChatEvent) => boolean,
): ChatState {
  let state = EMPTY_CHAT;
  let now = 1_000;
  for (const event of events) {
    state = reduceChat(state, event, (now += 10));
    if (until?.(event)) break;
  }
  return state;
}

describe("reduceChat on a turn with tools", () => {
  // The recorder asks for the history after the turn; the app only ever
  // gets it first, from a resumed session.
  const all = fixture("tools");
  const events = all.filter((e) => e.type !== "history");
  const state = replay(events);

  it("shows the sent prompt, the tool calls with their results, and the answer", () => {
    const kinds = state.items.map((i) =>
      i.kind === "tool" ? `tool:${i.name}` : i.kind,
    );
    expect(kinds[0]).toBe("user");
    expect(kinds).toContain("tool:Read");
    expect(kinds).toContain("tool:Write");
    // The answer, then the turn's closing line.
    expect(kinds.slice(-2)).toEqual(["text", "turn"]);
    for (const item of state.items) {
      if (item.kind === "tool") expect(item.result?.text).toBeTruthy();
    }
  });

  it("ends the turn with nothing still streaming", () => {
    expect(state.working).toBe(false);
    expect(state.turnStartedAt).toBeNull();
    expect(state.items.some((i) => "streaming" in i && i.streaming)).toBe(
      false,
    );
  });

  it("keeps the session, model and rate limits", () => {
    expect(state.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.model).toBe("claude-haiku-5-5");
    expect(state.limits.fiveHour?.utilization).toBeGreaterThanOrEqual(0);
  });

  it("streams the answer before its message lands, and counts the turn's tokens", () => {
    // Stop at the first text delta of the final answer.
    let seen = 0;
    const mid = replay(events, (e) => {
      if (e.type !== "sdk") return false;
      const ev = e.message.event as { delta?: { type?: string } } | undefined;
      return ev?.delta?.type === "text_delta" && ++seen === 1;
    });
    const last = mid.items.at(-1);
    expect(last?.kind).toBe("text");
    expect(last && "streaming" in last && last.streaming).toBe(true);
    expect(mid.working).toBe(true);
    expect(mid.turnTokens).toBeGreaterThan(0);
  });

  it("leaves the column alone when its history arrives for a subagent", () => {
    const withAgentHistory = reduceChat(
      state,
      {
        type: "history",
        chatId: "rec",
        agentId: "a1",
        messages: [],
        truncated: false,
      },
      0,
    );
    expect(withAgentHistory).toBe(state);
  });

  it("rebuilds the same column from history, with no duplicate", () => {
    const history = all.find((e) => e.type === "history");
    expect(history).toBeDefined();
    const fromHistory = reduceChat(EMPTY_CHAT, history!, 0);
    const kinds = (s: ChatState) =>
      s.items
        // A transcript keeps no turn ends (`result`): no closing line.
        .filter((i) => i.kind !== "thinking" && i.kind !== "turn")
        .map((i) => (i.kind === "tool" ? i.name : i.kind));
    expect(kinds(fromHistory)).toEqual(kinds(state));
  });

  it("starts over on a reattach, so a replay doesn't double the column", () => {
    const again = replay([
      ...events,
      { type: "attached", chatId: "rec" },
      ...events,
    ]);
    expect(again.items.length).toBe(state.items.length);
  });
});

describe("reduceChat on questions and plans", () => {
  it("holds an AskUserQuestion until it is answered", () => {
    const events = fixture("question");
    const pending = replay(events, (e) => e.type === "permission");
    expect(pending.requests).toHaveLength(1);
    expect(pending.requests[0].toolName).toBe("AskUserQuestion");
    const done = replay(events);
    expect(done.requests).toHaveLength(0);
  });

  it("finds the plan ExitPlanMode asks to approve, and follows the mode", () => {
    const events = fixture("plan");
    const pending = replay(
      events,
      (e) => e.type === "permission" && e.toolName === "ExitPlanMode",
    );
    expect(pending.mode).toBe("plan");
    expect(latestPlan(pending.items)).toContain("hello.txt");
    expect(replay(events).mode).not.toBe("plan");
  });
});

describe("reduceChat on a subagent", () => {
  const state = replay(fixture("subagent"));

  it("tracks the subagent to its end, outside the column", () => {
    expect(state.subagents).toHaveLength(1);
    const [agent] = state.subagents;
    expect(agent.status).toBe("completed");
    expect(agent.toolUses).toBeGreaterThan(0);
    expect(agent.summary).toBeTruthy();
    // Its own tool calls (Glob) stay out of the main column.
    expect(
      state.items.some((i) => i.kind === "tool" && i.name === "Glob"),
    ).toBe(false);
  });
});

describe("reduceChat on the status bar's figures", () => {
  const usage = (rateLimits: Record<string, unknown> | null): ChatEvent => ({
    type: "usage",
    chatId: "rec",
    rateLimits,
  });
  // Rows of a `/usage` reply, as Claude Code 2.1.314 sent them (team plan).
  const sessionRow = {
    kind: "session",
    group: "session",
    percent: 5,
    resets_at: "2026-10-31T00:20:00.856556+00:00",
  };
  const fableRow = {
    kind: "weekly_scoped",
    group: "weekly",
    percent: 19,
    resets_at: "2026-11-05T09:59:59.856729+00:00",
  };

  it("fills the five-hour window from /usage, before any turn", () => {
    const state = reduceChat(
      EMPTY_CHAT,
      usage({
        five_hour: { utilization: 5, resets_at: "2026-10-31T00:20:00+00:00" },
        seven_day: null,
        limits: [sessionRow],
      }),
      0,
    );
    expect(state.limits.fiveHour).toEqual({
      utilization: 0.05,
      resetsAt: Date.parse("2026-10-31T00:20:00Z") / 1000,
    });
  });

  it("reads the weekly window from the weekly_all row when seven_day is null", () => {
    const state = reduceChat(
      EMPTY_CHAT,
      usage({
        seven_day: null,
        limits: [
          sessionRow,
          {
            kind: "weekly_all",
            group: "weekly",
            percent: 12,
            resets_at: "2026-11-05T10:00:00+00:00",
          },
        ],
      }),
      0,
    );
    expect(state.limits.sevenDay?.utilization).toBe(0.12);
    expect(state.limits.fiveHour?.utilization).toBe(0.05);
  });

  it("shows no weekly window for a plan with only a per-model one", () => {
    const state = reduceChat(
      EMPTY_CHAT,
      usage({ seven_day: null, limits: [sessionRow, fableRow] }),
      0,
    );
    expect(state.limits.sevenDay).toBeUndefined();
  });

  it("takes a row's reset given in epoch seconds", () => {
    const state = reduceChat(
      EMPTY_CHAT,
      usage({
        five_hour: null,
        limits: [{ ...sessionRow, resets_at: 1_793_406_000 }],
      }),
      0,
    );
    expect(state.limits.fiveHour).toEqual({
      utilization: 0.05,
      resetsAt: 1_793_406_000,
    });
  });

  it("keeps the rate limit event's windows when /usage has none (API key)", () => {
    const seen: ChatState = {
      ...EMPTY_CHAT,
      limits: { fiveHour: { utilization: 0.37, resetsAt: 1_793_394_600 } },
    };
    expect(reduceChat(seen, usage(null), 0)).toBe(seen);
  });

  it("measures the context against the whole window, as its detail does", () => {
    const context = (totalTokens: number) =>
      reduceChat(
        EMPTY_CHAT,
        {
          type: "context",
          chatId: "rec",
          percentage: 21,
          totalTokens,
          maxTokens: 200_000,
        },
        0,
      ).context;
    expect(context(42_000)).toEqual({ percentage: 21 });
    expect(context(190_000)).toEqual({ percentage: 95 });
  });

  it("drops the branch when the folder has none any more", () => {
    const onBranch = reduceChat(
      EMPTY_CHAT,
      { type: "info", chatId: "rec", gitBranch: "master-lab" },
      0,
    );
    const titled = reduceChat(
      onBranch,
      { type: "info", chatId: "rec", title: "Refonte" },
      0,
    );
    expect(titled.gitBranch).toBe("master-lab");
    expect(
      reduceChat(titled, { type: "info", chatId: "rec", gitBranch: null }, 0)
        .gitBranch,
    ).toBeNull();
  });
});

describe("liveWindow", () => {
  it("reads a window past its reset as unused, its next reset unknown", () => {
    const win = { utilization: 0.9, resetsAt: 1_000 };
    expect(liveWindow(win, 999_000)).toBe(win);
    expect(liveWindow(win, 1_000_000)).toEqual({ utilization: 0 });
  });
});

describe("tasksOf", () => {
  const tool = (
    name: string,
    input: Record<string, unknown>,
    result?: string,
  ) => ({
    kind: "tool" as const,
    id: `${name}-${JSON.stringify(input)}`,
    name,
    input,
    result: result ? { text: result, isError: false } : undefined,
  });

  it("follows TaskCreate and TaskUpdate by task number", () => {
    const tasks = tasksOf([
      tool(
        "TaskCreate",
        { subject: "Lire" },
        "Task #1 created successfully: Lire",
      ),
      tool(
        "TaskCreate",
        { subject: "Écrire" },
        "Task #2 created successfully: Écrire",
      ),
      tool("TaskUpdate", { taskId: "1", status: "completed" }),
      tool("TaskUpdate", { taskId: "2", status: "in_progress" }),
    ]);
    expect(tasks.map((t) => `${t.subject}:${t.status}`)).toEqual([
      "Lire:completed",
      "Écrire:in_progress",
    ]);
  });

  it("takes TodoWrite's list as a whole", () => {
    const tasks = tasksOf([
      tool("TodoWrite", {
        todos: [
          { content: "A", status: "completed", activeForm: "a" },
          { content: "B", status: "pending", activeForm: "b" },
        ],
      }),
    ]);
    expect(tasks.map((t) => t.status)).toEqual(["completed", "pending"]);
  });
});

describe("visibleUserText", () => {
  it("shows a slash command as typed and hides Claude Code's own notices", () => {
    expect(
      visibleUserText(
        "<command-name>/model</command-name>\n<command-args>opus</command-args>",
      ),
    ).toBe("/model opus");
    expect(
      visibleUserText("<local-command-stdout>Set model</local-command-stdout>"),
    ).toBeNull();
    expect(visibleUserText("<system-reminder>x</system-reminder>")).toBeNull();
    expect(visibleUserText("  bonjour ")).toBe("bonjour");
  });
});

describe("a message sent while Claude works", () => {
  const sent = (uuid: string): ChatEvent => ({
    type: "user_sent",
    chatId: "c",
    text: uuid,
    images: 0,
    uuid,
  });
  const lifecycle = (uuid: string, state: string): ChatEvent => ({
    type: "sdk",
    chatId: "c",
    message: { type: "command_lifecycle", command_uuid: uuid, state },
  });
  const queued = (s: ChatState, uuid: string) => {
    const item = s.items.find((i) => i.id === `sent:${uuid}`);
    return item?.kind === "user" && item.queued === true;
  };

  // As Claude Code 2.1.314 sent them in a live check (31/10/2026).
  it("stays queued until Claude Code takes it, and keeps the turn's clock", () => {
    let state = reduceChat(EMPTY_CHAT, sent("u1"), 100);
    expect(queued(state, "u1")).toBe(false);
    state = reduceChat(state, sent("u2"), 200);
    expect(queued(state, "u2")).toBe(true);
    expect(state.turnStartedAt).toBe(100);
    state = reduceChat(state, lifecycle("u2", "queued"), 210);
    expect(queued(state, "u2")).toBe(true);
    state = reduceChat(state, lifecycle("u2", "started"), 300);
    expect(queued(state, "u2")).toBe(false);
  });

  it("shows as not sent once cancelled, or still waiting when the chat ends", () => {
    const dropped = (s: ChatState, uuid: string) => {
      const item = s.items.find((i) => i.id === `sent:${uuid}`);
      return item?.kind === "user" && item.dropped === true && !item.queued;
    };
    let state = reduceChat(EMPTY_CHAT, sent("u1"), 100);
    state = reduceChat(state, sent("u2"), 200);
    state = reduceChat(state, sent("u3"), 300);
    state = reduceChat(state, lifecycle("u2", "cancelled"), 400);
    expect(dropped(state, "u2")).toBe(true);
    expect(queued(state, "u3")).toBe(true);
    state = reduceChat(state, { type: "closed", chatId: "c" }, 500);
    expect(dropped(state, "u3")).toBe(true);
    expect(dropped(state, "u1")).toBe(false);
  });
});

describe("times, images and the turn's figures", () => {
  const sent = (at: number, images = 0): ChatEvent =>
    ({
      type: "user_sent",
      chatId: "c",
      text: "Regarde",
      images,
      pasted: Array.from({ length: images }, () => ({
        mediaType: "image/png",
        data: "AAAA",
      })),
      at,
    }) as ChatEvent;

  it("dates each message: the server's stamp, else the SDK's timestamp", () => {
    let state = reduceChat(EMPTY_CHAT, sent(5_000, 1), 9_999);
    const reply: ChatEvent = {
      type: "sdk",
      chatId: "c",
      message: {
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-10-31T10:00:00.000Z",
        message: { id: "m1", content: [{ type: "text", text: "Vu." }] },
      },
    };
    state = reduceChat(state, reply, 9_999);
    const [user, text] = state.items;
    expect(user.at).toBe(5_000);
    expect(user.kind === "user" && user.pasted).toEqual([
      "data:image/png;base64,AAAA",
    ]);
    expect(text.at).toBe(Date.parse("2026-10-31T10:00:00.000Z"));
  });

  it("keeps the pasted images of the newest messages only, and their count", () => {
    let state = EMPTY_CHAT;
    for (let i = 0; i < 21; i++) state = reduceChat(state, sent(i, 1), i);
    const [first, second] = state.items;
    expect(first.kind === "user" && first.pasted).toBeUndefined();
    expect(first.kind === "user" && first.images).toBe(1);
    expect(second.kind === "user" && second.pasted).toHaveLength(1);
  });

  it("keeps the texts a message sent from tags, for its frame's tags", () => {
    const state = reduceChat(
      EMPTY_CHAT,
      {
        type: "user_sent",
        chatId: "c",
        text: "Corrige ce log",
        images: 0,
        pastes: ["ce log"],
        uuid: "u1",
      },
      1,
    );
    const [user] = state.items;
    expect(user.kind === "user" && user.pastes).toEqual(["ce log"]);
  });

  it("shows a resumed message's pastes out of Claude Code's tags", () => {
    const log =
      "TypeError: Cannot read properties of undefined reading tabs at restoreSession";
    const state = reduceChat(
      EMPTY_CHAT,
      {
        type: "history",
        chatId: "c",
        truncated: false,
        messages: [
          {
            type: "user",
            uuid: "h1",
            message: {
              content: [
                {
                  type: "text",
                  text: `Corrige ce log :\n\n<pasted_content id="d947">\n${log}\n</pasted_content id="d947">\n`,
                },
              ],
            },
          },
        ],
      },
      0,
    );
    const [user] = state.items;
    expect(user.kind === "user" && user.text).toBe(
      `Corrige ce log :\n\n${log}`,
    );
    expect(user.kind === "user" && user.pastes).toEqual([log]);
  });

  it("reads the times and pasted images of a resumed session", () => {
    const state = reduceChat(
      EMPTY_CHAT,
      {
        type: "history",
        chatId: "c",
        truncated: false,
        messages: [
          {
            type: "user",
            uuid: "h1",
            timestamp: "2026-10-30T08:00:00.000Z",
            message: {
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: "QQ",
                  },
                },
                { type: "text", text: "Et ça ?" },
              ],
            },
          },
        ],
      },
      0,
    );
    const [user] = state.items;
    expect(user.at).toBe(Date.parse("2026-10-30T08:00:00.000Z"));
    expect(user.kind === "user" && user.pasted).toEqual([
      "data:image/jpeg;base64,QQ",
    ]);
  });

  it("closes a turn with its duration, its tool calls and the files edited", () => {
    const state = replay(fixture("tools").filter((e) => e.type !== "history"));
    const turn = state.items[state.items.length - 1];
    expect(turn).toMatchObject({ kind: "turn", tools: 2, files: 1 });
    expect(turn.kind === "turn" && turn.durationMs).toBe(7867);
  });

  it("follows the running call, a subagent's included, until the turn ends", () => {
    const events = fixture("subagent");
    const running = replay(
      events,
      (e) =>
        e.type === "sdk" &&
        e.message.type === "assistant" &&
        Boolean(e.message.parent_tool_use_id),
    );
    expect(running.liveTools.map((t) => [t.name, t.agent])).toEqual([
      ["Agent", false],
      ["Bash", true],
    ]);
    const done = replay(events);
    expect(done.liveTools).toEqual([]);
    expect(done.livePhase).toBeNull();
  });

  it("says what the request does while no tool runs", () => {
    const answering = replay(
      fixture("tools"),
      (e) =>
        e.type === "sdk" &&
        (e.message.event as { delta?: { type?: string } } | undefined)?.delta
          ?.type === "text_delta",
    );
    expect(answering.liveTools).toEqual([]);
    expect(answering.livePhase).toBe("responding");
  });

  it("marks an API error written as Claude's reply", () => {
    const state = reduceChat(
      EMPTY_CHAT,
      {
        type: "sdk",
        chatId: "c",
        message: {
          type: "assistant",
          uuid: "e1",
          error: "rate_limit",
          message: { id: "m", content: [{ type: "text", text: "Limite" }] },
        },
      },
      0,
    );
    expect(state.items[0]).toMatchObject({ kind: "text", error: true });
  });
});
