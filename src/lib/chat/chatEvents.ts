import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatCommand, ChatEvent } from "@/lib/chat/chatProtocol";

/**
 * The page's link to the chat servers (`chat.rs`): one `chat-event` listener
 * for the page's whole life, dispatching each line to its chat. Chats come
 * and go, the listener stays, so it never leaks one per chat, and a chat
 * waits for it before starting: none of its first events can be missed.
 */

type Listener = (event: ChatEvent) => void;

/** A chat's end when its account's server stops. */
export const SERVER_GONE = "Le serveur du chat s'est arrêté";

const byChat = new Map<string, Set<Listener>>();
const onExit = new Set<(account: string) => void>();
let ready: Promise<void> | null = null;

/**
 * What the sidebar and the chat / terminal switch need of every chat, shown
 * or not (another project's chat pane is not mounted): whether Claude is in
 * a turn, how many of its requests wait on the user, and what still runs in
 * the background after its turn. As in a terminal pane: a subagent or a
 * workflow keeps Claude busy (`withBackgroundTasks`), a shell or a watcher
 * leaves it waiting (`withBackgroundShells`). Ambient tasks count for none.
 */
export interface ChatActivity {
  busy: boolean;
  pending: number;
  tasks: string[];
  shells: string[];
}

export const IDLE_CHAT: ChatActivity = {
  busy: false,
  pending: 0,
  tasks: [],
  shells: [],
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

export function nextActivity(
  prev: ChatActivity,
  event: ChatEvent,
): ChatActivity {
  switch (event.type) {
    case "attached":
    case "closed":
      return IDLE_CHAT;
    case "user_sent":
      return { ...prev, busy: true };
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

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);
const sameActivity = (a: ChatActivity, b: ChatActivity) =>
  a.busy === b.busy &&
  a.pending === b.pending &&
  sameIds(a.tasks, b.tasks) &&
  sameIds(a.shells, b.shells);

const activity = new Map<string, ChatActivity>();
const onActivity = new Set<(chatId: string) => void>();
/** Each chat's account key (`chat.rs`), to clear its chats when its server stops. */
const accountOf = new Map<string, string>();
/** Chats replaying their life after a reattach: their activity isn't current yet. */
const replaying = new Set<string>();

export function chatActivity(chatId: string): ChatActivity {
  return activity.get(chatId) ?? IDLE_CHAT;
}

/** Between `attached` and `replayed`: the switch waits, the badge too. */
export function chatReplaying(chatId: string): boolean {
  return replaying.has(chatId);
}

export function subscribeChatActivity(
  cb: (chatId: string) => void,
): () => void {
  onActivity.add(cb);
  return () => onActivity.delete(cb);
}

/**
 * Subscribers hear at most every 16 ms per burst, and nothing while a chat
 * replays (each change would render the whole app): they read the current
 * activity when told, so a change and its undo inside a burst cost nothing.
 */
const NOTIFY_MS = 16;
const dirty = new Set<string>();
let notifyTimer: ReturnType<typeof setTimeout> | undefined;

function notifySoon(chatId: string): void {
  dirty.add(chatId);
  notifyTimer ??= setTimeout(() => {
    notifyTimer = undefined;
    const ids = [...dirty].filter((id) => !replaying.has(id));
    for (const id of ids) dirty.delete(id);
    for (const id of ids) for (const cb of onActivity) cb(id);
  }, NOTIFY_MS);
}

function setActivity(chatId: string, next: ChatActivity): void {
  if (sameActivity(next, chatActivity(chatId))) return;
  activity.set(chatId, next);
  notifySoon(chatId);
}

function dispatch(line: string): void {
  let event: ChatEvent;
  try {
    event = JSON.parse(line) as ChatEvent;
  } catch {
    return;
  }
  if (event.type === "server_exit") {
    // Its chats are gone: nothing works nor waits in them any more.
    const gone: string[] = [];
    for (const [chatId, account] of accountOf) {
      if (account !== event.account) continue;
      replaying.delete(chatId);
      setActivity(chatId, IDLE_CHAT);
      gone.push(chatId);
    }
    for (const cb of onExit) cb(event.account);
    // Each of them ended: the watch of every chat hears it as its `closed`
    // (a turn cut there is an end to notify, `chatNotify`).
    for (const chatId of gone) {
      const closed: ChatEvent = { type: "closed", chatId, error: SERVER_GONE };
      for (const cb of everyChat) cb(closed);
    }
    return;
  }
  if (!("chatId" in event) || !event.chatId) return;
  const chatId = event.chatId;
  if (event.type === "attached") replaying.add(chatId);
  setActivity(chatId, nextActivity(chatActivity(chatId), event));
  if (event.type === "replayed" || event.type === "closed") {
    replaying.delete(chatId);
    notifySoon(chatId);
  }
  for (const cb of byChat.get(chatId) ?? []) cb(event);
  for (const cb of everyChat) cb(event);
}

/** Resolves once the page listens to the chat servers. */
export function chatEventsReady(): Promise<void> {
  ready ??= listen<string>("chat-event", (e) => dispatch(e.payload)).then(
    () => undefined,
  );
  return ready;
}

/** Every chat's events, shown or not (the usage limit's watch). */
const everyChat = new Set<Listener>();

export function subscribeEveryChat(cb: Listener): () => void {
  everyChat.add(cb);
  return () => everyChat.delete(cb);
}

export function subscribeChat(chatId: string, cb: Listener): () => void {
  let set = byChat.get(chatId);
  if (!set) {
    set = new Set();
    byChat.set(chatId, set);
  }
  set.add(cb);
  return () => {
    const s = byChat.get(chatId);
    s?.delete(cb);
    if (s?.size === 0) byChat.delete(chatId);
  };
}

/** `account` is the server's key: an account id, or `main`. */
export function subscribeServerExit(cb: (account: string) => void): () => void {
  onExit.add(cb);
  return () => onExit.delete(cb);
}

/** A closed chat's Claude Code is gone by then: another may take its session. */
const CLOSE_GRACE_MS = 500;

/** Closes a chat and waits for its Claude Code to go. */
export async function closeChat(
  accountId: string | undefined,
  chatId: string,
): Promise<void> {
  await chatCommand(accountId, { type: "close", chatId });
  await new Promise((r) => setTimeout(r, CLOSE_GRACE_MS));
}

export function chatCommand(
  accountId: string | undefined,
  command: ChatCommand,
): Promise<void> {
  if (command.type === "start")
    accountOf.set(command.chatId, accountId ?? "main");
  return invoke("chat_command", { accountId: accountId ?? null, command });
}
