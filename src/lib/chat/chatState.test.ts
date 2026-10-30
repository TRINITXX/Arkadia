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
    expect(kinds.at(-1)).toBe("text");
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
        .filter((i) => i.kind !== "thinking")
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

  it("measures the context against 80 % of the window, as the terminal's Ctx(u)", () => {
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
    expect(context(42_000)).toEqual({ percentage: 26.25 });
    expect(context(190_000)).toEqual({ percentage: 100 });
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
