import type { JsonObject, WorkflowLiveAgent } from "@/lib/chat/chatProtocol";
import type { ChatItem, ChatState, Subagent } from "@/lib/chat/chatState";

/**
 * Claude's background work, as the SDK's task events tell it: subagents
 * (`local_agent`), shells and monitors (`local_bash`, `monitor`), workflows
 * (`local_workflow`). Each kind has its own place in the view: agent cards
 * above the input, the workflow card against it, the shells chip under it.
 * Pure, like `chatState`: `now` comes in with each event.
 */

/** A command Claude runs in the background (`run_in_background`, Ctrl+B), or a Monitor. */
export interface BackgroundShell {
  taskId: string;
  /** Its run (`run_id`): a resumed task keeps its id, gets a new run. */
  runId?: string;
  /** The Bash call that started it: its command. */
  toolUseId?: string;
  description: string;
  kind: "shell" | "monitor";
  /** A foreground command counts only once sent to the background (Ctrl+B). */
  background: boolean;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt: number;
}

export interface WorkflowPhase {
  index: number;
  title: string;
}

export interface WorkflowAgent {
  agentId: string;
  label: string;
  phaseIndex: number;
  model?: string;
  state: "queued" | "running" | "done" | "failed" | "skipped";
  startedAt?: number;
  durationMs?: number;
  tokens?: number;
  toolCalls?: number;
  /** Its last write: the idle time counts from there. */
  lastActivityAt?: number;
  lastTool?: string;
  /** Its state came from its workflow's end, not its own (`endAgents`): a
   *  later end of the workflow says it again (a guessed end, then its
   *  notification). */
  byWorkflow?: boolean;
}

export interface Workflow {
  taskId: string;
  runId?: string;
  toolUseId?: string;
  name: string;
  description: string;
  status: Subagent["status"];
  startedAt: number;
  endedAt?: number;
  tokens: number;
  toolUses: number;
  durationMs: number;
  phases: WorkflowPhase[];
  agents: WorkflowAgent[];
}

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" ? v : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

type Kind = "agent" | "shell" | "monitor" | "workflow";

/** What a task is; null for the kinds no view shows (MCP tasks, remote runs…). */
function kindOf(taskType: unknown): Kind | null {
  switch (taskType) {
    // Older CLIs say nothing: their tasks were all subagents.
    case undefined:
    case "local_agent":
      return "agent";
    case "local_bash":
      return "shell";
    case "monitor":
      return "monitor";
    case "local_workflow":
      return "workflow";
    default:
      return null;
  }
}

type Ended = "completed" | "failed" | "stopped";

/** A task's end as the SDK words it: `killed` is a stop. */
function endedStatus(v: unknown): Ended | null {
  if (v === "completed" || v === "failed" || v === "stopped") return v;
  return v === "killed" ? "stopped" : null;
}

/**
 * A workflow ended takes its agents with it: those still running or waiting
 * are done if it completed, failed otherwise (stopped, or cut by its chat's
 * end). Whatever changes a workflow goes through here, its ends and the
 * frames that come after them: left running, its agents' lines turned for
 * good and their sheets read on every 2 s. An agent ended here follows a
 * later end of its workflow (`byWorkflow`): one that ended on its own keeps
 * its state.
 */
function endAgents(wf: Workflow): Workflow {
  if (wf.status === "running") return wf;
  const state = wf.status === "completed" ? "done" : "failed";
  const held = (a: WorkflowAgent) =>
    a.state === "running" ||
    a.state === "queued" ||
    (a.byWorkflow === true && a.state !== state);
  if (!wf.agents.some(held)) return wf;
  return {
    ...wf,
    agents: wf.agents.map((a) =>
      held(a) ? { ...a, state, byWorkflow: true } : a,
    ),
  };
}

function upsert<T extends { taskId: string }>(
  list: T[],
  taskId: string,
  make: (prev: T | undefined) => T,
): T[] {
  const i = list.findIndex((t) => t.taskId === taskId);
  if (i < 0) return [...list, make(undefined)];
  const next = list.slice();
  next[i] = make(list[i]);
  return next;
}

function patch<T extends { taskId: string }>(
  list: T[],
  taskId: string,
  change: (prev: T) => T,
): T[] {
  const i = list.findIndex((t) => t.taskId === taskId);
  if (i < 0) return list;
  const next = list.slice();
  next[i] = change(list[i]);
  return next;
}

/**
 * Whether a task's start or listing opens a new run of it: unknown so far, a
 * later run id (a subagent resumed by SendMessage keeps its task id), or a
 * start of one that ended (a resumed session's « interrompu » agent). It
 * then runs again, its clocks and figures afresh. A level set that still
 * lists an ended run late never revives it.
 */
function freshRun(
  prev: { status: string; runId?: string } | undefined,
  runId: string | undefined,
  started: boolean,
): boolean {
  if (!prev) return true;
  if (runId && prev.runId && runId !== prev.runId) return runId > prev.runId;
  return started && prev.status !== "running";
}

/**
 * A task known from its start (`started`) or the level set: one of the
 * three lists.
 */
function addTask(
  state: ChatState,
  m: JsonObject,
  now: number,
  background: boolean,
  started: boolean,
): ChatState {
  const taskId = str(m.task_id);
  const kind = kindOf(m.task_type);
  // Ambient tasks (watchers, housekeeping) are no activity.
  if (!taskId || !kind || m.ambient === true || m.skip_transcript === true)
    return state;
  const description = str(m.description) ?? "";
  const runId = str(m.run_id);
  // What a new run starts from; the same run keeps what it had.
  const run = <T extends { status: string; runId?: string }>(prev?: T) => {
    const fresh = freshRun(prev, runId, started);
    return {
      fresh,
      runId: fresh ? (runId ?? prev?.runId) : (prev?.runId ?? runId),
    };
  };
  if (kind === "agent") {
    return {
      ...state,
      subagents: upsert(state.subagents, taskId, (prev) => {
        const r = run(prev);
        const kept = r.fresh ? undefined : prev;
        return {
          ...kept,
          taskId,
          runId: r.runId,
          toolUseId: str(m.tool_use_id) ?? prev?.toolUseId,
          parentTaskId: str(m.parent_task_id) ?? prev?.parentTaskId,
          description: description || prev?.description || "",
          type: str(m.subagent_type) ?? prev?.type,
          status: r.fresh ? "running" : (prev?.status ?? "running"),
          toolUses: kept?.toolUses ?? 0,
          tokens: kept?.tokens ?? 0,
          durationMs: kept?.durationMs ?? 0,
          startedAt: kept?.startedAt ?? now,
          background: background || kept?.background === true,
        };
      }),
    };
  }
  if (kind === "workflow") {
    return {
      ...state,
      workflows: upsert(state.workflows, taskId, (prev) => {
        const r = run(prev);
        const kept = r.fresh ? undefined : prev;
        return {
          taskId,
          runId: r.runId,
          toolUseId: str(m.tool_use_id) ?? prev?.toolUseId,
          name: str(m.workflow_name) ?? prev?.name ?? description,
          description: description || prev?.description || "",
          status: r.fresh ? "running" : (prev?.status ?? "running"),
          startedAt: kept?.startedAt ?? now,
          endedAt: kept?.endedAt,
          tokens: kept?.tokens ?? 0,
          toolUses: kept?.toolUses ?? 0,
          durationMs: kept?.durationMs ?? 0,
          phases: kept?.phases ?? [],
          agents: kept?.agents ?? [],
        };
      }),
    };
  }
  return {
    ...state,
    shells: upsert(state.shells, taskId, (prev) => {
      const r = run(prev);
      const kept = r.fresh ? undefined : prev;
      return {
        taskId,
        runId: r.runId,
        toolUseId: str(m.tool_use_id) ?? prev?.toolUseId,
        description: description || prev?.description || "",
        kind,
        // A Monitor runs beside the turn from its start.
        background:
          background || kind === "monitor" || kept?.background === true,
        status: r.fresh ? "running" : (prev?.status ?? "running"),
        startedAt: kept?.startedAt ?? now,
      };
    }),
  };
}

const AGENT_STATES: Record<string, WorkflowAgent["state"]> = {
  queued: "queued",
  start: "running",
  running: "running",
  done: "done",
  error: "failed",
  failed: "failed",
  skipped: "skipped",
};

/**
 * A workflow's phases and agents as Claude Code's own /workflows view has them:
 * `task_progress.workflow_progress` (not in the SDK's types, seen live on
 * 2.1.314), sent at each agent's start and end. What the journal watcher
 * added for a running agent (tokens, last write) stays until its end.
 */
function workflowProgress(wf: Workflow, entries: unknown[]): Workflow {
  const phases: WorkflowPhase[] = [];
  const agents: WorkflowAgent[] = [];
  for (const raw of entries) {
    const e = obj(raw);
    if (e.type === "workflow_phase") {
      phases.push({
        index: num(e.index) ?? phases.length + 1,
        title: str(e.title) ?? "",
      });
    } else if (e.type === "workflow_agent") {
      const agentId = str(e.agentId) ?? `#${num(e.index) ?? agents.length}`;
      const prev = wf.agents.find((a) => a.agentId === agentId);
      const state = AGENT_STATES[str(e.state) ?? ""] ?? "running";
      const running = state === "running";
      agents.push({
        agentId,
        label: str(e.label) ?? prev?.label ?? "",
        phaseIndex: num(e.phaseIndex) ?? prev?.phaseIndex ?? 0,
        model: str(e.model) ?? prev?.model,
        state,
        startedAt: num(e.startedAt) ?? prev?.startedAt,
        durationMs: num(e.durationMs) ?? prev?.durationMs,
        tokens: num(e.tokens) ?? (running ? prev?.tokens : undefined),
        toolCalls: num(e.toolCalls) ?? prev?.toolCalls,
        lastActivityAt: running
          ? Math.max(num(e.lastProgressAt) ?? 0, prev?.lastActivityAt ?? 0) ||
            undefined
          : num(e.lastProgressAt),
        lastTool:
          str(e.lastToolSummary) ?? str(e.lastToolName) ?? prev?.lastTool,
      });
    }
  }
  return { ...wf, phases: phases.length > 0 ? phases : wf.phases, agents };
}

/** The journal watcher's look at a running workflow (`workflow_live`). */
export function addWorkflowLive(
  state: ChatState,
  taskId: string,
  live: WorkflowLiveAgent[],
): ChatState {
  return {
    ...state,
    workflows: patch(state.workflows, taskId, (wf) => {
      let phases = wf.phases;
      let agents = wf.agents;
      for (const a of live) {
        let phase = phases.find((p) => p.title === a.phase);
        if (!phase) {
          phase = { index: phases.length + 1, title: a.phase };
          phases = [...phases, phase];
        }
        const i = agents.findIndex((x) => x.agentId === a.agentId);
        const prev = agents[i] as WorkflowAgent | undefined;
        // The SDK's end figures win over the watcher's last look.
        const ended =
          prev && prev.state !== "running" && prev.state !== "queued";
        const next: WorkflowAgent = {
          agentId: a.agentId,
          label: prev?.label || a.label,
          phaseIndex: prev?.phaseIndex || phase.index,
          model: prev?.model ?? a.model,
          state: prev?.state ?? (a.done ? "done" : "running"),
          startedAt: prev?.startedAt,
          durationMs: prev?.durationMs,
          tokens: ended ? prev.tokens : (a.tokens ?? prev?.tokens),
          toolCalls: prev?.toolCalls,
          lastActivityAt: ended
            ? prev.lastActivityAt
            : (a.lastActivityAt ?? prev?.lastActivityAt),
          lastTool: prev?.lastTool,
          byWorkflow: prev?.byWorkflow,
        };
        agents =
          i < 0
            ? [...agents, next]
            : agents.map((x, j) => (j === i ? next : x));
      }
      // A look that comes after its end starts no agent again.
      return endAgents({ ...wf, phases, agents });
    }),
  };
}

/** The task_* and background_tasks_changed system messages. */
export function addTaskEvent(
  state: ChatState,
  m: JsonObject,
  now: number,
): ChatState {
  const taskId = str(m.task_id) ?? "";
  // A frame naming a run before the one shown is late (the SDK's run ids sort).
  const runId = str(m.run_id);
  const live = <T extends { taskId: string; runId?: string }>(
    list: T[],
    change: (t: T) => T,
  ): T[] =>
    patch(list, taskId, (t) =>
      runId && t.runId && runId < t.runId ? t : change(t),
    );
  switch (m.subtype) {
    case "task_started":
      return addTask(state, m, now, m.is_backgrounded === true, true);
    case "task_progress": {
      const usage = obj(m.usage);
      const progress = arr(m.workflow_progress);
      return {
        ...state,
        subagents: live(state.subagents, (s) => ({
          ...s,
          toolUses: num(usage.tool_uses) ?? s.toolUses,
          tokens: num(usage.total_tokens) ?? s.tokens,
          durationMs: num(usage.duration_ms) ?? s.durationMs,
          lastTool: str(m.last_tool_name) ?? s.lastTool,
          summary: str(m.summary) ?? s.summary,
          retry: undefined,
        })),
        workflows: live(state.workflows, (w) => {
          const next = {
            ...w,
            tokens: num(usage.total_tokens) ?? w.tokens,
            toolUses: num(usage.tool_uses) ?? w.toolUses,
            durationMs: num(usage.duration_ms) ?? w.durationMs,
          };
          // A frame that comes after its end starts no agent again.
          return progress.length > 0
            ? endAgents(workflowProgress(next, progress))
            : next;
        }),
      };
    }
    case "task_updated": {
      const p = obj(m.patch);
      const status = endedStatus(p.status);
      const background = p.is_backgrounded === true;
      if (!status && !background) return state;
      const end = <T extends { status: string }>(t: T): T =>
        status && t.status === "running" ? { ...t, status, endedAt: now } : t;
      return {
        ...state,
        subagents: live(state.subagents, (s) =>
          end({ ...s, background: s.background || background }),
        ),
        shells: live(state.shells, (s) =>
          end({ ...s, background: s.background || background }),
        ),
        workflows: live(state.workflows, (w) => endAgents(end(w))),
      };
    }
    case "task_notification": {
      const status = endedStatus(m.status) ?? "completed";
      const usage = obj(m.usage);
      return {
        ...state,
        subagents: live(state.subagents, (s) => ({
          ...s,
          status,
          endedAt: s.endedAt ?? now,
          toolUses: num(usage.tool_uses) ?? s.toolUses,
          tokens: num(usage.total_tokens) ?? s.tokens,
          durationMs: num(usage.duration_ms) ?? s.durationMs,
          summary: str(m.summary) ?? s.summary,
          retry: undefined,
        })),
        shells: live(state.shells, (s) => ({ ...s, status })),
        workflows: live(state.workflows, (w) =>
          endAgents({ ...w, status, endedAt: w.endedAt ?? now }),
        ),
      };
    }
    case "background_tasks_changed":
      return backgroundLevel(state, arr(m.tasks).map(obj), now);
    default:
      return state;
  }
}

/**
 * The whole live background set, replacing ours: a background row it lacks
 * ended without its notification reaching us, and one we never saw starts.
 * A foreground subagent is never in it: only background rows go.
 */
function backgroundLevel(
  state: ChatState,
  tasks: JsonObject[],
  now: number,
): ChatState {
  const live = new Set(tasks.map((t) => str(t.task_id)));
  let next = tasks.reduce((s, t) => addTask(s, t, now, true, false), state);
  const gone = <T extends { taskId: string; status: string }>(t: T): T =>
    t.status === "running" && !live.has(t.taskId)
      ? { ...t, status: "completed", endedAt: now }
      : t;
  next = {
    ...next,
    subagents: next.subagents.map((s) => (s.background ? gone(s) : s)),
    shells: next.shells.map((s) => (s.background ? gone(s) : s)),
    workflows: next.workflows.map((w) => endAgents(gone(w))),
  };
  return next;
}

/**
 * A subagent's own message (`parent_tool_use_id`): its last action for its
 * card, and the message kept for its live conversation (`agentConversation`).
 */
export function addSubagentMessage(state: ChatState, m: JsonObject): ChatState {
  const parent = str(m.parent_tool_use_id);
  if (!parent || (m.type !== "assistant" && m.type !== "user")) return state;
  const i = state.subagents.findIndex((s) => s.toolUseId === parent);
  if (i < 0) return state;
  const tools = arr(obj(m.message).content)
    .map(obj)
    .filter((b) => b.type === "tool_use");
  const last = tools[tools.length - 1];
  const subagents = state.subagents.slice();
  subagents[i] = {
    ...subagents[i],
    retry: m.type === "assistant" ? undefined : subagents[i].retry,
    lastAction: last
      ? { name: str(last.name) ?? "?", input: obj(last.input) }
      : subagents[i].lastAction,
  };
  return {
    ...state,
    subagents,
    agentMessages: {
      ...state.agentMessages,
      [parent]: [...(state.agentMessages[parent] ?? []), m],
    },
  };
}

/**
 * `tool_progress`: a tool's running time (a heartbeat every 30 s, its
 * start corrects ours after a replay), and a subagent's retries.
 */
export function addToolProgress(
  state: ChatState,
  m: JsonObject,
  now: number,
): ChatState {
  const id = str(m.tool_use_id);
  const elapsed = num(m.elapsed_time_seconds);
  let next = state;
  if (id && elapsed !== undefined && state.liveTools.some((t) => t.id === id)) {
    next = {
      ...next,
      liveTools: next.liveTools.map((t) =>
        t.id === id ? { ...t, startedAt: now - elapsed * 1000 } : t,
      ),
    };
  }
  const retry = obj(m.subagent_retry);
  const agentId = str(retry.agent_id);
  const attempt = num(retry.attempt);
  if (agentId && attempt !== undefined) {
    next = {
      ...next,
      subagents: next.subagents.map((s) =>
        s.taskId === agentId || (id && s.toolUseId === id)
          ? {
              ...s,
              retry: {
                attempt,
                max: num(retry.max_retries) ?? attempt,
                status: num(retry.error_status) ?? undefined,
              },
            }
          : s,
      ),
    };
  }
  return next;
}

/** `<tag>value</tag>` of Claude Code's notes. */
const tag = (text: string, name: string) =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(text)?.[1]?.trim();

/**
 * The subagents of a resumed session, from its past: one whose end the
 * transcript never got ran when its Claude Code stopped, « interrompu ». A
 * background agent ends with a `<task-notification>` naming its call.
 */
export function historySubagents(
  messages: JsonObject[],
  items: ChatItem[],
): Subagent[] {
  const ends = new Map<string, Ended>();
  for (const m of messages) {
    if (m.type !== "user") continue;
    const content = obj(m.message).content;
    const texts =
      typeof content === "string"
        ? [content]
        : arr(content)
            .map(obj)
            .filter((b) => b.type === "text")
            .map((b) => str(b.text) ?? "");
    for (const text of texts) {
      if (!text.includes("<task-notification>")) continue;
      const toolUseId = tag(text, "tool-use-id");
      const status = endedStatus(tag(text, "status"));
      if (toolUseId && status) ends.set(toolUseId, status);
    }
  }
  return items.flatMap((item): Subagent[] => {
    if (item.kind !== "tool" || (item.name !== "Agent" && item.name !== "Task"))
      return [];
    const result = item.result?.text ?? "";
    const launched = /^Async agent launched/i.test(result.trim());
    const status: Subagent["status"] =
      ends.get(item.id) ??
      (!item.result || launched
        ? "interrupted"
        : item.result.isError
          ? "failed"
          : "completed");
    return [
      {
        taskId: /agentId:\s*([\w-]+)/.exec(result)?.[1] ?? item.id,
        toolUseId: item.id,
        description: str(item.input.description) ?? "",
        type: str(item.input.subagent_type),
        status,
        toolUses: 0,
        tokens: 0,
        durationMs: 0,
      },
    ];
  });
}

/** Running, or ended less than this ago: its card shows ✓ before leaving. */
export const CARD_LINGER_MS = 2500;

/** The subagents whose card is above the input at `now`: running, or just ended. */
export function agentCards(subagents: Subagent[], now: number): Subagent[] {
  return subagents.filter(
    (s) =>
      s.status === "running" ||
      (s.endedAt !== undefined && now - s.endedAt < CARD_LINGER_MS),
  );
}

/** How long a subagent has run, or ran; a resumed session's has no start: its duration. */
export function agentElapsed(
  agent: Pick<Subagent, "startedAt" | "endedAt" | "durationMs">,
  now: number,
): number {
  return agent.startedAt
    ? (agent.endedAt ?? now) - agent.startedAt
    : agent.durationMs;
}

/** A stop sent to a subagent: when, and to which run of it (its start). */
export interface SentStop {
  at: number;
  run: number | undefined;
}

/** A stop sent and the agent still running this long: the button again. */
export const STOP_RETRY_MS = 10_000;

/**
 * Whether a subagent shows « arrêt demandé… » in place of its stop: still
 * running, the run the stop went to, for `STOP_RETRY_MS` at most. A stop
 * refused or lost gives the button back, and an agent run again
 * (SendMessage) goes on without the old stop.
 */
export function stopPending(
  stop: SentStop | undefined,
  agent: Pick<Subagent, "status" | "startedAt">,
  now: number,
): boolean {
  return (
    !!stop &&
    agent.status === "running" &&
    stop.run === agent.startedAt &&
    now - stop.at < STOP_RETRY_MS
  );
}

/**
 * How many agent pills the row holds (`widths`, measured): all when they
 * fit, else as many as leave room for the « +N » pill (`more`).
 */
export function pillsThatFit(
  widths: number[],
  room: number,
  gap: number,
  more: number,
): number {
  const total = widths.reduce((s, w, i) => s + w + (i ? gap : 0), 0);
  if (total <= room) return widths.length;
  let used = 0;
  let n = 0;
  for (const w of widths) {
    const next = used + (n ? gap : 0) + w;
    if (next + gap + more > room) break;
    used = next;
    n++;
  }
  return n;
}

/** « Agents terminés (N) » shows this long after the latest subagent ended. */
export const DONE_AGENTS_MS = 30_000;

/**
 * Until when « Agents terminés (N) » shows (ms), null for not at all:
 * `DONE_AGENTS_MS` past the latest subagent's end, none once the user sent
 * a message or a command since. Their rows in the column still open them;
 * an agent of a resumed session has no end time and never brings it back.
 */
export function doneAgentsUntil(
  subagents: Subagent[],
  items: ChatItem[],
): number | null {
  let lastEnd: number | undefined;
  for (const s of subagents)
    if (s.status !== "running" && s.endedAt !== undefined)
      lastEnd = Math.max(lastEnd ?? s.endedAt, s.endedAt);
  if (lastEnd === undefined) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "user" && item.kind !== "command") continue;
    if (item.at !== undefined && item.at >= lastEnd) return null;
    break;
  }
  return lastEnd + DONE_AGENTS_MS;
}

/** The workflow card: the latest running one, or one that just ended. */
export function workflowCard(
  workflows: Workflow[],
  now: number,
): Workflow | undefined {
  for (let i = workflows.length - 1; i >= 0; i--) {
    const w = workflows[i];
    if (w.status === "running") return w;
    if (w.endedAt !== undefined && now - w.endedAt < CARD_LINGER_MS) return w;
  }
  return undefined;
}

/** The shells the chip counts: in the background and still running. */
export function runningShells(shells: BackgroundShell[]): BackgroundShell[] {
  return shells.filter((s) => s.background && s.status === "running");
}

/** A workflow's phase at work: its latest running agent's, else its last (0: none yet). */
export function workflowActivePhase(wf: Workflow): number {
  for (let i = wf.agents.length - 1; i >= 0; i--)
    if (wf.agents[i].state === "running") return wf.agents[i].phaseIndex;
  return wf.phases[wf.phases.length - 1]?.index ?? 0;
}

/** A workflow's agents done, of those it started so far. */
export function workflowCounts(wf: Workflow): { done: number; total: number } {
  return {
    done: wf.agents.filter(
      (a) =>
        a.state === "done" || a.state === "failed" || a.state === "skipped",
    ).length,
    total: wf.agents.length,
  };
}

/** The chat ended: what still ran in the background ended with its Claude Code. */
export function interruptTasks(state: ChatState, now: number): ChatState {
  const cut = <T extends { status: string; endedAt?: number }>(t: T): T =>
    t.status === "running" ? { ...t, status: "interrupted", endedAt: now } : t;
  return {
    ...state,
    subagents: state.subagents.map(cut),
    workflows: state.workflows.map((w) => endAgents(cut(w))),
    shells: state.shells.map((s) =>
      s.status === "running" ? { ...s, status: "stopped" } : s,
    ),
  };
}

/** How many of its last lines the shells list shows. */
export const SHELL_TAIL_LINES = 12;

/**
 * The last lines of an output, as plain text: the command's colours and
 * cursor moves dropped, a carriage return's overwrite kept.
 */
export function outputTail(output: string, lines = SHELL_TAIL_LINES): string {
  const plain = output
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
    .replace(/\r\n/g, "\n");
  const rows = plain.split("\n").map((row) => {
    // « 50 %\r » ends a progress line: the last overwrite is what shows.
    const line = row.replace(/\r+$/, "");
    return line.slice(line.lastIndexOf("\r") + 1);
  });
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows.slice(-lines).join("\n");
}

/**
 * The foreground subagents Esc must spare: Claude Code's interrupt kills a
 * running foreground Agent call with the turn (checked live 31/10/2026), so
 * these go to the background first (`backgroundTasks(toolUseId)`). A nested
 * one goes on with its parent. Background agents and workflows already
 * outlive the interrupt (`perTaskStopAffordance`).
 */
export function spareOnInterrupt(subagents: Subagent[]): string[] {
  return subagents.flatMap((s) =>
    s.status === "running" && !s.background && !s.parentTaskId && s.toolUseId
      ? [s.toolUseId]
      : [],
  );
}

/**
 * How Esc and « Envoyer maintenant » end Claude's turn and spare its
 * foreground subagents (`spareOnInterrupt`). Backgrounding them hands their
 * Agent calls a result, and at that boundary Claude Code takes the waiting
 * messages into the turn: an interrupt then would cut them, never to run
 * (`cancel_queued` in the SDK's types). So with a message waiting, the
 * backgrounding alone moves Claude on to it; otherwise it goes first, then
 * the interrupt.
 */
export function stopTurnPlan(
  subagents: Subagent[],
  items: ChatItem[],
): { spare: string[]; interrupt: boolean } {
  const spare = spareOnInterrupt(subagents);
  // Only a user message is taken at a tool boundary: a slash command waits
  // for the turn's end, which the interrupt brings.
  const messageWaiting = items.some((i) => i.kind === "user" && i.queued);
  return { spare, interrupt: spare.length === 0 || !messageWaiting };
}

/**
 * How a message goes « now » (Ctrl+Entrée): with foreground agents running,
 * queued, then they go to the background and Claude takes it at that
 * boundary (`spare`); a `now` would end them with the turn. A slash command
 * isn't taken there: it keeps `now`.
 */
export function sendNowPlan(
  subagents: Subagent[],
  isCommand: boolean,
): { spare: string[]; priority: boolean } {
  const spare = isCommand ? [] : spareOnInterrupt(subagents);
  return { spare, priority: spare.length === 0 };
}
