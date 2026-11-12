import { describe, expect, it } from "vitest";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import {
  EMPTY_CHAT,
  reduceChat,
  type ChatItem,
  type ChatState,
} from "@/lib/chat/chatState";
import {
  agentConversation,
  currentAgent,
  withRunningCalls,
} from "@/lib/chat/chatAgentView";
import {
  agentCards,
  agentElapsed,
  CARD_LINGER_MS,
  DONE_AGENTS_MS,
  doneAgentsUntil,
  historySubagents,
  outputTail,
  pillsThatFit,
  runningShells,
  sendNowPlan,
  spareOnInterrupt,
  STOP_RETRY_MS,
  stopPending,
  stopTurnPlan,
  workflowActivePhase,
} from "@/lib/chat/chatTasks";

const sdk = (message: JsonObject, at = 1000): ChatEvent =>
  ({ type: "sdk", chatId: "c", message, at }) as ChatEvent;
const task = (subtype: string, extra: JsonObject = {}, at?: number) =>
  sdk({ type: "system", subtype, ...extra }, at);
const run = (events: ChatEvent[], from: ChatState = EMPTY_CHAT) =>
  events.reduce((s, e) => reduceChat(s, e, 0), from);

describe("background tasks", () => {
  it("keeps shells, monitors and workflows out of the subagents (task_type)", () => {
    const s = run([
      task("task_started", {
        task_id: "a1",
        task_type: "local_agent",
        description: "Lire",
      }),
      task("task_started", {
        task_id: "b1",
        task_type: "local_bash",
        is_backgrounded: true,
      }),
      task("task_started", { task_id: "m1", task_type: "monitor" }),
      task("task_started", {
        task_id: "w1",
        task_type: "local_workflow",
        workflow_name: "probe",
      }),
      task("task_started", {
        task_id: "x1",
        task_type: "local_agent",
        ambient: true,
      }),
    ]);
    expect(s.subagents.map((a) => a.taskId)).toEqual(["a1"]);
    expect(s.shells.map((x) => [x.taskId, x.kind])).toEqual([
      ["b1", "shell"],
      ["m1", "monitor"],
    ]);
    expect(s.workflows.map((w) => [w.taskId, w.name])).toEqual([
      ["w1", "probe"],
    ]);
  });

  it("counts a foreground command as a shell once Ctrl+B sends it away", () => {
    let s = run([
      task("task_started", {
        task_id: "b1",
        task_type: "local_bash",
        is_backgrounded: false,
      }),
    ]);
    expect(runningShells(s.shells)).toEqual([]);
    s = run(
      [
        task("task_updated", {
          task_id: "b1",
          patch: { is_backgrounded: true },
        }),
      ],
      s,
    );
    expect(runningShells(s.shells).map((x) => x.taskId)).toEqual(["b1"]);
  });

  it("ends the background rows the live set lacks, never a foreground agent", () => {
    const s = run([
      task("task_started", {
        task_id: "fg",
        task_type: "local_agent",
        is_backgrounded: false,
      }),
      task("task_started", {
        task_id: "bg",
        task_type: "local_agent",
        is_backgrounded: true,
      }),
      task("task_started", {
        task_id: "sh",
        task_type: "local_bash",
        is_backgrounded: true,
      }),
      // A task we never saw start joins from the level alone.
      task("background_tasks_changed", {
        tasks: [
          { task_id: "new", task_type: "local_bash", description: "watch" },
        ],
      }),
    ]);
    const status = (id: string) =>
      [...s.subagents, ...s.shells].find((t) => t.taskId === id)?.status;
    expect(status("fg")).toBe("running");
    expect(status("bg")).toBe("completed");
    expect(status("sh")).toBe("completed");
    expect(status("new")).toBe("running");
  });

  it("marks what still ran « interrompu » when the chat ends", () => {
    const s = run([
      task("task_started", {
        task_id: "a1",
        task_type: "local_agent",
        is_backgrounded: true,
      }),
      task("task_started", { task_id: "a2", task_type: "local_agent" }),
      task("task_notification", { task_id: "a2", status: "completed" }),
      { type: "closed", chatId: "c" },
    ]);
    expect(s.subagents.map((a) => a.status)).toEqual([
      "interrupted",
      "completed",
    ]);
  });

  it("shows an ended card a moment, then drops it", () => {
    const s = run([
      task("task_started", { task_id: "a1", task_type: "local_agent" }, 1000),
      task("task_notification", { task_id: "a1", status: "completed" }, 5000),
    ]);
    expect(agentCards(s.subagents, 5000 + CARD_LINGER_MS - 1)).toHaveLength(1);
    expect(agentCards(s.subagents, 5000 + CARD_LINGER_MS)).toHaveLength(0);
  });
});

describe("« Agents terminés »", () => {
  const started = (id: string, at: number) =>
    task("task_started", { task_id: id, task_type: "local_agent" }, at);
  const ended = (id: string, at: number) =>
    task("task_notification", { task_id: id, status: "completed" }, at);
  const sent = (at: number): ChatEvent =>
    ({
      type: "user_sent",
      chatId: "c",
      text: "Suite",
      images: 0,
      at,
    }) as ChatEvent;
  const until = (s: ChatState) => doneAgentsUntil(s.subagents, s.items);

  it("stays 30 s after the last subagent ended, longer if another ends", () => {
    let s = run([started("a1", 1000), started("a2", 1000)]);
    expect(until(s)).toBeNull();
    s = run([ended("a1", 5000)], s);
    expect(until(s)).toBe(5000 + DONE_AGENTS_MS);
    s = run([ended("a2", 20_000)], s);
    expect(until(s)).toBe(20_000 + DONE_AGENTS_MS);
  });

  it("goes when the user writes again, back if an agent ends after", () => {
    let s = run([started("a1", 1000), started("a2", 1000), ended("a1", 5000)]);
    s = run([sent(8000)], s);
    expect(until(s)).toBeNull();
    s = run([ended("a2", 9000)], s);
    expect(until(s)).toBe(9000 + DONE_AGENTS_MS);
  });

  it("never shows for a resumed session's agents (no end time)", () => {
    const resumed: ChatItem[] = [
      {
        kind: "tool",
        id: "t1",
        name: "Agent",
        input: { description: "Lire" },
        result: { text: "Fini", isError: false },
      },
    ];
    expect(doneAgentsUntil(historySubagents([], resumed), resumed)).toBeNull();
  });
});

describe("task runs", () => {
  it("runs a resumed subagent again (same task, new run), late frames left out", () => {
    let s = run([
      task(
        "task_started",
        { task_id: "a1", task_type: "local_agent", run_id: "r1" },
        1000,
      ),
      task(
        "task_notification",
        { task_id: "a1", run_id: "r1", status: "completed" },
        2000,
      ),
    ]);
    s = run(
      [
        task(
          "task_started",
          { task_id: "a1", task_type: "local_agent", run_id: "r2" },
          9000,
        ),
        // The first run's end, arriving late.
        task(
          "task_notification",
          { task_id: "a1", run_id: "r1", status: "completed" },
          9500,
        ),
      ],
      s,
    );
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0]).toMatchObject({
      status: "running",
      startedAt: 9000,
      runId: "r2",
    });
    expect(s.subagents[0].endedAt).toBeUndefined();
  });

  it("restarts a resumed session's « interrompu » agent when it starts again", () => {
    let s = run([
      task("task_started", { task_id: "a1", task_type: "local_agent" }, 1000),
      { type: "closed", chatId: "c" },
    ]);
    expect(s.subagents[0].status).toBe("interrupted");
    s = run(
      [task("task_started", { task_id: "a1", task_type: "local_agent" }, 5000)],
      s,
    );
    expect(s.subagents[0]).toMatchObject({
      status: "running",
      startedAt: 5000,
    });
  });
});

describe("Esc", () => {
  it("never interrupts over a waiting message when it spares an agent", () => {
    const s = run([
      task("task_started", {
        task_id: "fg",
        task_type: "local_agent",
        tool_use_id: "t-fg",
      }),
    ]);
    const message: ChatItem = {
      kind: "user",
      id: "m",
      text: "x",
      images: 0,
      queued: true,
    };
    const command: ChatItem = {
      kind: "command",
      id: "c",
      name: "/compact",
      args: "",
      absorbed: [],
      queued: true,
    };
    // The backgrounding hands Claude the waiting message: an interrupt would cut it.
    expect(stopTurnPlan(s.subagents, [message])).toEqual({
      spare: ["t-fg"],
      interrupt: false,
    });
    // A slash command waits for the turn's end: the turn must stop.
    expect(stopTurnPlan(s.subagents, [command])).toEqual({
      spare: ["t-fg"],
      interrupt: true,
    });
    expect(stopTurnPlan([], [message])).toEqual({ spare: [], interrupt: true });
  });

  it("sends a message now by sparing the agents, a slash command with `now`", () => {
    const s = run([
      task("task_started", {
        task_id: "fg",
        task_type: "local_agent",
        tool_use_id: "t-fg",
      }),
    ]);
    expect(sendNowPlan(s.subagents, false)).toEqual({
      spare: ["t-fg"],
      priority: false,
    });
    expect(sendNowPlan(s.subagents, true)).toEqual({
      spare: [],
      priority: true,
    });
    expect(sendNowPlan([], false)).toEqual({ spare: [], priority: true });
  });

  it("spares the running foreground agents of the main loop only", () => {
    const s = run([
      task("task_started", {
        task_id: "fg",
        task_type: "local_agent",
        tool_use_id: "t-fg",
        is_backgrounded: false,
      }),
      task("task_started", {
        task_id: "bg",
        task_type: "local_agent",
        tool_use_id: "t-bg",
        is_backgrounded: true,
      }),
      task("task_started", {
        task_id: "nested",
        task_type: "local_agent",
        tool_use_id: "t-n",
        parent_task_id: "fg",
      }),
      task("task_started", {
        task_id: "done",
        task_type: "local_agent",
        tool_use_id: "t-d",
      }),
      task("task_notification", { task_id: "done", status: "completed" }),
    ]);
    expect(spareOnInterrupt(s.subagents)).toEqual(["t-fg"]);
  });
});

describe("subagent cards", () => {
  it("counts a pill's time from its start, a resumed agent's from its duration", () => {
    const agent = { startedAt: 1000, durationMs: 0 };
    expect(agentElapsed(agent, 4000)).toBe(3000);
    expect(agentElapsed({ ...agent, endedAt: 2500 }, 4000)).toBe(1500);
    expect(agentElapsed({ durationMs: 700 }, 4000)).toBe(700);
  });

  it("keeps room for « +N » once the pills overflow the row", () => {
    expect(pillsThatFit([100, 100], 206, 6, 48)).toBe(2);
    expect(pillsThatFit([100, 100, 100], 300, 6, 48)).toBe(2);
    expect(pillsThatFit([100, 100, 100], 250, 6, 48)).toBe(1);
    expect(pillsThatFit([280], 260, 6, 48)).toBe(0);
  });

  it("says « arrêt demandé… » for the run stopped, 10 s at most", () => {
    const stop = { at: 5000, run: 1000 };
    const running = { status: "running" as const, startedAt: 1000 };
    expect(stopPending(stop, running, 5000 + STOP_RETRY_MS - 1)).toBe(true);
    expect(stopPending(stop, running, 5000 + STOP_RETRY_MS)).toBe(false);
    // Run again by SendMessage: a new start, the old stop is not its own.
    expect(stopPending(stop, { ...running, startedAt: 9000 }, 6000)).toBe(
      false,
    );
    expect(stopPending(stop, { ...running, status: "stopped" }, 6000)).toBe(
      false,
    );
  });

  it("follows the opened agent: the chat's, else a workflow's", () => {
    const s = run([
      task("task_started", { task_id: "a1", task_type: "local_agent" }),
      task("task_started", { task_id: "w1", task_type: "local_workflow" }),
      task("task_progress", {
        task_id: "w1",
        workflow_progress: [
          {
            type: "workflow_agent",
            agentId: "w-a",
            label: "lit",
            state: "done",
          },
        ],
      }),
    ]);
    const opened = {
      taskId: "",
      description: "",
      toolUses: 0,
      tokens: 0,
      durationMs: 0,
    };
    expect(
      currentAgent(s, { ...opened, taskId: "a1", status: "completed" }).status,
    ).toBe("running");
    expect(
      currentAgent(s, { ...opened, taskId: "w-a", status: "running" }).status,
    ).toBe("completed");
    const gone = { ...opened, taskId: "x", status: "failed" as const };
    expect(currentAgent(s, gone)).toBe(gone);
  });

  it("keeps a running agent's call under way running in its sheet", () => {
    const call = (id: string) => ({
      type: "assistant",
      uuid: `a-${id}`,
      message: {
        id: `m-${id}`,
        content: [{ type: "tool_use", id, name: "Read", input: {} }],
      },
    });
    // Its first call answered, its second under way.
    const read = agentConversation([
      call("r1"),
      {
        type: "user",
        uuid: "u-r1",
        message: {
          content: [{ type: "tool_result", tool_use_id: "r1", content: "ok" }],
        },
      },
      call("r2"),
    ]);
    const stale = (s: typeof read) =>
      s.items.flatMap((x) => (x.kind === "tool" ? [[x.id, !!x.stale]] : []));
    // Read as a past: an agent that ended left it without a result.
    expect(stale(read)).toEqual([
      ["r1", false],
      ["r2", true],
    ]);
    expect(stale(withRunningCalls(read))).toEqual([
      ["r1", false],
      ["r2", false],
    ]);
    // Nothing held: the same conversation, no row drawn again.
    const none = agentConversation([]);
    expect(withRunningCalls(none)).toBe(none);
  });

  it("takes its last action and keeps its messages for the sheet", () => {
    const s = run([
      task("task_started", {
        task_id: "a1",
        task_type: "local_agent",
        tool_use_id: "t1",
      }),
      sdk({
        type: "assistant",
        parent_tool_use_id: "t1",
        message: {
          content: [
            {
              type: "tool_use",
              id: "x",
              name: "Read",
              input: { file_path: "a.ts" },
            },
          ],
        },
      }),
      sdk({
        type: "assistant",
        parent_tool_use_id: "zz",
        message: { content: [] },
      }),
    ]);
    expect(s.subagents[0].lastAction).toEqual({
      name: "Read",
      input: { file_path: "a.ts" },
    });
    expect(Object.keys(s.agentMessages)).toEqual(["t1"]);
    // Not in the column: its card and sheet only.
    expect(s.items).toEqual([]);
  });

  it("says a retry from tool_progress, cleared by its next progress", () => {
    let s = run([
      task("task_started", {
        task_id: "a1",
        task_type: "local_agent",
        tool_use_id: "t1",
      }),
      sdk({
        type: "tool_progress",
        tool_use_id: "t1",
        elapsed_time_seconds: 40,
        subagent_retry: {
          agent_id: "a1",
          attempt: 2,
          max_retries: 10,
          error_status: 529,
        },
      }),
    ]);
    expect(s.subagents[0].retry).toEqual({ attempt: 2, max: 10, status: 529 });
    s = run(
      [task("task_progress", { task_id: "a1", usage: { total_tokens: 5 } })],
      s,
    );
    expect(s.subagents[0].retry).toBeUndefined();
  });

  it("dates a running tool from its heartbeat after a replay", () => {
    const s = run([
      sdk(
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "b", name: "Bash", input: {} }],
          },
        },
        100_000,
      ),
      sdk(
        { type: "tool_progress", tool_use_id: "b", elapsed_time_seconds: 30 },
        130_000,
      ),
    ]);
    expect(s.liveTools[0].startedAt).toBe(100_000);
  });

  it("counts thinking's estimate until the real count comes", () => {
    let s = run([
      task("thinking_tokens", {
        estimated_tokens: 50,
        estimated_tokens_delta: 50,
      }),
      task("thinking_tokens", {
        estimated_tokens: 311,
        estimated_tokens_delta: 261,
      }),
    ]);
    expect(s.thinkingTokens).toBe(311);
    s = run(
      [
        sdk({
          type: "stream_event",
          api_message_id: "m",
          event: { type: "message_delta", usage: { output_tokens: 400 } },
        }),
      ],
      s,
    );
    expect([s.thinkingTokens, s.turnTokens]).toEqual([0, 400]);
  });
});

describe("workflow card", () => {
  const started = task("task_started", {
    task_id: "w1",
    task_type: "local_workflow",
    workflow_name: "probe",
    description: "Deux agents",
  });
  const progress = (state: string, extra: JsonObject = {}) =>
    task("task_progress", {
      task_id: "w1",
      usage: { total_tokens: 39340, tool_uses: 1, duration_ms: 1000 },
      workflow_progress: [
        { type: "workflow_phase", index: 1, title: "Un" },
        { type: "workflow_phase", index: 2, title: "Deux" },
        {
          type: "workflow_agent",
          index: 1,
          label: "agent-un",
          phaseIndex: 1,
          agentId: "a0",
          model: "claude-haiku-5-5",
          state,
          startedAt: 10,
          lastProgressAt: 10,
          ...extra,
        },
      ],
    });

  it("opens on the phase at work, else the last one", () => {
    const s = run([started, progress("start")]);
    expect(workflowActivePhase(s.workflows[0])).toBe(1);
    const ended = run([progress("done")], s);
    expect(workflowActivePhase(ended.workflows[0])).toBe(2);
    expect(workflowActivePhase(run([started]).workflows[0])).toBe(0);
  });

  it("reads phases and agents from workflow_progress (seen live on 2.1.314)", () => {
    const s = run([started, progress("start")]);
    const wf = s.workflows[0];
    expect(wf.phases.map((p) => p.title)).toEqual(["Un", "Deux"]);
    expect(wf.agents[0]).toMatchObject({
      label: "agent-un",
      state: "running",
      phaseIndex: 1,
    });
    expect(wf.tokens).toBe(39340);
  });

  it("adds the journal's live tokens and last write, the SDK's end figures win", () => {
    let s = run([
      started,
      progress("start"),
      {
        type: "workflow_live",
        chatId: "c",
        taskId: "w1",
        agents: [
          {
            agentId: "a0",
            label: "agent-un",
            phase: "Un",
            done: false,
            tokens: 1200,
            lastActivityAt: 5000,
          },
        ],
      },
    ]);
    expect(s.workflows[0].agents[0]).toMatchObject({
      tokens: 1200,
      lastActivityAt: 5000,
    });
    s = run([progress("done", { tokens: 41986, durationMs: 9761 })], s);
    expect(s.workflows[0].agents[0]).toMatchObject({
      state: "done",
      tokens: 41986,
      durationMs: 9761,
    });
  });
});

describe("resumed subagents", () => {
  const call = (id: string): JsonObject => ({
    type: "assistant",
    uuid: `u-${id}`,
    message: {
      id: `m-${id}`,
      content: [
        { type: "tool_use", id, name: "Agent", input: { description: id } },
      ],
    },
  });
  const result = (id: string, text: string): JsonObject => ({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: [{ type: "text", text }],
        },
      ],
    },
  });

  it("marks « interrompu » an agent whose end the transcript never got", () => {
    const s = run([
      {
        type: "history",
        chatId: "c",
        truncated: false,
        messages: [
          call("fg-done"),
          result("fg-done", "Fini.\nagentId: a1 (use SendMessage…)"),
          call("fg-cut"),
          call("bg-done"),
          result(
            "bg-done",
            "Async agent launched successfully.\nagentId: a3 (internal ID)",
          ),
          call("bg-cut"),
          result(
            "bg-cut",
            "Async agent launched successfully.\nagentId: a4 (internal ID)",
          ),
          {
            type: "user",
            message: {
              content:
                "<task-notification>\n<task-id>a3</task-id>\n<tool-use-id>bg-done</tool-use-id>\n<status>completed</status>\n</task-notification>",
            },
          },
        ],
      },
    ]);
    expect(s.subagents.map((a) => [a.toolUseId, a.taskId, a.status])).toEqual([
      ["fg-done", "a1", "completed"],
      ["fg-cut", "fg-cut", "interrupted"],
      ["bg-done", "a3", "completed"],
      ["bg-cut", "a4", "interrupted"],
    ]);
  });
});

describe("outputTail", () => {
  it("drops colours and keeps a progress line's last overwrite", () => {
    expect(outputTail("\x1b[32mok\x1b[0m\n10 %\r50 %\r\n\n")).toBe("ok\n50 %");
    expect(outputTail("1\n2\n3\n4", 2)).toBe("3\n4");
  });
});
