import type { ChatEvent } from "@/lib/chat/chatProtocol";

/**
 * What the sidebar and the chat / terminal switch need of every chat, shown
 * or not (another project's chat pane is not mounted): whether Claude is in
 * a turn, how many of its requests wait on the user, and what still runs in
 * the background after its turn. As in a terminal pane: a subagent or a
 * workflow keeps Claude busy (`withBackgroundTasks`), a shell or a watcher
 * leaves it waiting (`withBackgroundShells`). Ambient tasks count for none.
 * The user's `!` commands count until Claude Code wrote their entries
 * (`bangs`): a relaunch, a switch or a change of account would kill them.
 */
export interface ChatActivity {
  busy: boolean;
  pending: number;
  tasks: string[];
  shells: string[];
  /** `!` commands running, then waiting for their entries to be written (ids). */
  bangs: string[];
  /** Messages and commands the server holds behind them (uuids), not taken yet. */
  held: string[];
}

export const IDLE_CHAT: ChatActivity = {
  busy: false,
  pending: 0,
  tasks: [],
  shells: [],
  bangs: [],
  held: [],
};

const SHELL_TASKS = new Set(["local_bash", "monitor"]);
const ENDED = new Set(["completed", "failed", "stopped", "killed"]);

type TaskInfo = { task_id?: unknown; task_type?: unknown; ambient?: unknown };

const without = (ids: string[], id: string) => ids.filter((t) => t !== id);

/** Where a started task goes: nowhere (ambient), shells, or tasks. */
function addTask(prev: ChatActivity, task: TaskInfo): ChatActivity {
  const id = typeof task.task_id === "string" ? task.task_id : null;
  if (!id || task.ambient === true) return prev;
  if (SHELL_TASKS.has(String(task.task_type))) {
    return prev.shells.includes(id)
      ? prev
      : { ...prev, shells: [...prev.shells, id] };
  }
  return prev.tasks.includes(id)
    ? prev
    : { ...prev, tasks: [...prev.tasks, id] };
}

function systemActivity(
  prev: ChatActivity,
  m: Record<string, unknown>,
): ChatActivity {
  // The whole live set, replacing ours: a task whose end never came goes.
  if (m.subtype === "background_tasks_changed" && Array.isArray(m.tasks)) {
    return (m.tasks as TaskInfo[]).reduce(addTask, {
      ...prev,
      tasks: [],
      shells: [],
    });
  }
  if (m.subtype === "task_started") return addTask(prev, m);
  const id = typeof m.task_id === "string" ? m.task_id : null;
  if (!id) return prev;
  const patch = m.patch as { status?: string } | undefined;
  const ended =
    m.subtype === "task_notification" ||
    (m.subtype === "task_updated" && ENDED.has(patch?.status ?? ""));
  if (!ended || (!prev.tasks.includes(id) && !prev.shells.includes(id)))
    return prev;
  return {
    ...prev,
    tasks: without(prev.tasks, id),
    shells: without(prev.shells, id),
  };
}

/**
 * A message or command held behind a `!` command, taken by Claude Code: its
 * turn starts (/compact streams nothing). Only those: a `!` entry's own
 * frames would leave `busy` set, their result never comes.
 */
function heldTaken(
  prev: ChatActivity,
  m: Record<string, unknown>,
): ChatActivity {
  const uuid = typeof m.command_uuid === "string" ? m.command_uuid : null;
  if (!uuid || !prev.held.includes(uuid) || m.state === "queued") return prev;
  const held = without(prev.held, uuid);
  if (m.state === "cancelled") return { ...prev, held };
  return { ...prev, held, busy: true };
}

export function nextActivity(
  prev: ChatActivity,
  event: ChatEvent,
): ChatActivity {
  switch (event.type) {
    case "attached":
    case "closed":
      return IDLE_CHAT;
    // Held behind a `!` command, it waits in the server: its turn starts
    // when Claude Code takes it (`heldTaken`).
    case "user_sent":
      if (prev.bangs.length === 0) return { ...prev, busy: true };
      return event.uuid ? { ...prev, held: [...prev.held, event.uuid] } : prev;
    case "queued_removed":
      return prev.held.includes(event.uuid)
        ? { ...prev, held: without(prev.held, event.uuid) }
        : prev;
    case "bash":
      if (event.state === "running") {
        return prev.bangs.includes(event.id)
          ? prev
          : { ...prev, bangs: [...prev.bangs, event.id] };
      }
      // An end not counted (after its chat's `closed`) counts for nothing;
      // one that couldn't start has no entries to wait for.
      if (!prev.bangs.includes(event.id) || !event.error) return prev;
      return { ...prev, bangs: without(prev.bangs, event.id) };
    // Its entries written, as the server alone judges it.
    case "bash_written":
      return prev.bangs.includes(event.id)
        ? { ...prev, bangs: without(prev.bangs, event.id) }
        : prev;
    // An MCP server's request waits on the user as a permission does.
    case "permission":
    case "elicitation":
      return { ...prev, pending: prev.pending + 1 };
    case "permission_resolved":
    case "elicitation_resolved":
      return { ...prev, pending: Math.max(0, prev.pending - 1) };
    case "sdk": {
      const m = event.message;
      if (m.type === "system") return systemActivity(prev, m);
      if (m.type === "command_lifecycle") return heldTaken(prev, m);
      if (m.parent_tool_use_id) return prev;
      // A request still open (a subagent's) outlives the turn: only a close
      // or a reattach clears them.
      if (m.type === "result") return { ...prev, busy: false };
      if (m.type === "stream_event" || m.type === "assistant") {
        return prev.busy ? prev : { ...prev, busy: true };
      }
      return prev;
    }
    default:
      return prev;
  }
}
