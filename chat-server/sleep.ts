// When a chat's Claude Code may go to sleep (`Chat.sleepIfDue`): each one
// costs 1.6 to 3 GB with its MCP servers, so a chat left alone stops it and
// starts it again on the session when the user comes back. Pure: the page
// reads the defaults too (the Lab's setting, `chatSleep.ts`).

/** The Lab's default: 30 min without anything done in the chat. */
export const DEFAULT_SLEEP_MS = 30 * 60_000;

/** How often the server looks for chats to put to sleep. */
export const SLEEP_CHECK_MS = 30_000;

/** The Lab setting's choices; null: never. */
export const SLEEP_CHOICES: readonly (number | null)[] = [
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  null,
];

/** What keeps a chat awake, whatever the time. */
export interface SleepFacts {
  /** A turn runs (a message sent, Claude streaming), until its `result`. */
  turn: boolean;
  /** Background agents, workflows, shells, monitors (ambient ones aside). */
  tasks: number;
  /** Permissions, AskUserQuestion, plans, MCP requests waiting on the user. */
  requests: number;
  /** Messages sent that Claude Code hasn't taken yet. */
  queued: number;
  /** `!` commands of the user still running. */
  bangs: number;
  /** Wakeups Claude scheduled (ScheduleWakeup, CronCreate, /loop): asleep, they would never fire. */
  crons: number;
}

export const AT_REST: SleepFacts = {
  turn: false,
  tasks: 0,
  requests: 0,
  queued: 0,
  bangs: 0,
  crons: 0,
};

/** Nothing runs nor waits in the chat. */
export function atRest(f: SleepFacts): boolean {
  return (
    !f.turn &&
    f.tasks === 0 &&
    f.requests === 0 &&
    f.queued === 0 &&
    f.bangs === 0 &&
    f.crons === 0
  );
}

/** Time to sleep: at rest, and nothing done in it for `afterMs` (null: never). */
export function sleepDue(
  facts: SleepFacts,
  lastActive: number,
  now: number,
  afterMs: number | null,
): boolean {
  if (afterMs === null || !atRest(facts)) return false;
  return now - lastActive >= afterMs;
}

/** The setting as a command carries it: a delay in ms, null (never), or undefined (not said). */
export function readSleepAfter(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return undefined;
}

type Message = Record<string, unknown>;

/** A turn opens with its first streamed or written reply, ends with its `result`. */
export function turnAfter(turn: boolean, m: Message): boolean {
  if (m.parent_tool_use_id) return turn;
  if (m.type === "result") return false;
  if (m.type === "stream_event" || m.type === "assistant") return true;
  return turn;
}

type TaskInfo = { task_id?: unknown; ambient?: unknown; task_type?: unknown };

const ENDED = new Set(["completed", "failed", "stopped", "killed"]);

/** Shells and monitors, as the page's `chatActivity` sorts them. */
const SHELL_TASKS = new Set(["local_bash", "monitor"]);

/** Work Claude will come back on: a subagent, a workflow… never a shell or a monitor. */
export function notShell(taskType: unknown): boolean {
  return !(typeof taskType === "string" && SHELL_TASKS.has(taskType));
}

/**
 * The background tasks running, by id: `background_tasks_changed` replaces
 * the set (a task whose end never came goes), a start adds one, its end or a
 * final status removes it. Ambient ones (Claude Code's housekeeping) count
 * for none, as in the page's `chatActivity`; nor those `counts` leaves out
 * by their `task_type` (`notShell`).
 */
export function tasksAfter(
  running: readonly string[],
  m: Message,
  counts: (taskType: unknown) => boolean = () => true,
): readonly string[] {
  if (m.type !== "system") return running;
  if (m.subtype === "background_tasks_changed" && Array.isArray(m.tasks)) {
    return (m.tasks as TaskInfo[]).flatMap((t) =>
      typeof t.task_id === "string" && t.ambient !== true && counts(t.task_type) ? [t.task_id] : [],
    );
  }
  const id = typeof m.task_id === "string" ? m.task_id : null;
  if (!id) return running;
  if (m.subtype === "task_started") {
    return m.ambient === true || !counts(m.task_type) || running.includes(id) ? running : [...running, id];
  }
  const status = (m.patch as { status?: unknown } | undefined)?.status;
  const ended =
    m.subtype === "task_notification" ||
    (m.subtype === "task_updated" && typeof status === "string" && ENDED.has(status));
  return ended ? running.filter((t) => t !== id) : running;
}

/**
 * Its input ended, a Claude Code with a subagent or a workflow still running
 * waits for it, and the kit kills it only then: 2 s of grace, 5 s more on
 * Windows (`ProcessTransport.close`, kit 0.3.314), while its messages end
 * after 2 s. Measured 12/11/2026: gone 7.1 s after the close.
 */
const TASKS_KILL_WAIT_MS = 8_000;

/**
 * How long a closed chat waits to say `closed` (ms): with a subagent or a
 * workflow running, until the kit killed its Claude Code. The page resumes
 * the session elsewhere on `closed` (an account switch): never two on one.
 */
export function closedDelayMs(agentTasks: readonly string[]): number {
  return agentTasks.length > 0 ? TASKS_KILL_WAIT_MS : 0;
}

/**
 * Messages sent and not yet taken: a lifecycle frame past « queued » takes
 * one (started, or cancelled: gone either way), a turn's frames list those it
 * consumed, and a turn's end lets the rest go to its successor.
 */
export function queuedAfter(queued: readonly string[], m: Message): readonly string[] {
  if (queued.length === 0) return queued;
  if (m.type === "result" && !m.parent_tool_use_id) return [];
  if (m.type === "command_lifecycle") {
    return m.state === "queued" ? queued : queued.filter((u) => u !== m.command_uuid);
  }
  const taken = Array.isArray(m.user_message_uuids) ? m.user_message_uuids : [];
  return taken.length === 0 ? queued : queued.filter((u) => !taken.includes(u));
}

/**
 * Messages Claude Code took and hasn't finished, by uuid: « started » adds
 * one, any later frame (« completed », a cancel) or the turn's end removes
 * it (a frame missed never wedges it). A turn taken runs from then, seconds
 * before it says anything (`requesting`, its first words): its
 * UserPromptSubmit hooks, its request on a big context.
 */
export function takenAfter(taken: readonly string[], m: Message): readonly string[] {
  if (m.type === "result" && !m.parent_tool_use_id) return taken.length === 0 ? taken : [];
  if (m.type !== "command_lifecycle" || typeof m.command_uuid !== "string") return taken;
  const uuid = m.command_uuid;
  if (m.state === "queued") return taken;
  if (m.state === "started") return taken.includes(uuid) ? taken : [...taken, uuid];
  return taken.filter((u) => u !== uuid);
}

/** The wakeups a Stop hook says are scheduled (`session_crons`). */
export function cronCount(input: unknown): number {
  const crons = (input as { session_crons?: unknown } | null)?.session_crons;
  return Array.isArray(crons) ? crons.length : 0;
}
