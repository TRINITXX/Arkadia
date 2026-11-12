import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  IDLE_CHAT,
  nextActivity,
  type ChatActivity,
} from "@/lib/chat/chatActivity";
import type { ChatCommand, ChatEvent } from "@/lib/chat/chatProtocol";
import { desktopTakesBack, SERVER_GONE } from "@/lib/chat/phoneChat";

/**
 * The page's link to the chat servers (`chat.rs`): one `chat-event` listener
 * for the page's whole life, dispatching each line to its chat. Chats come
 * and go, the listener stays, so it never leaks one per chat, and a chat
 * waits for it before starting: none of its first events can be missed.
 */

type Listener = (event: ChatEvent) => void;

export { SERVER_GONE } from "@/lib/chat/phoneChat";

const byChat = new Map<string, Set<Listener>>();
const onExit = new Set<(account: string) => void>();
let ready: Promise<void> | null = null;

// Pure, in its own module: the iPhone app folds them too (`phoneChatFeel`).
export {
  IDLE_CHAT,
  nextActivity,
  type ChatActivity,
} from "@/lib/chat/chatActivity";

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);
const sameActivity = (a: ChatActivity, b: ChatActivity) =>
  a.busy === b.busy &&
  a.pending === b.pending &&
  sameIds(a.tasks, b.tasks) &&
  sameIds(a.shells, b.shells) &&
  sameIds(a.bangs, b.bangs) &&
  sameIds(a.held, b.held);

const activity = new Map<string, ChatActivity>();
const onActivity = new Set<(chatId: string) => void>();
/** Each chat's account key (`chat.rs`), to clear its chats when its server stops. */
const accountOf = new Map<string, string>();
/**
 * Accounts whose server runs now, as far as this page knows: a start went
 * there, no exit since. Rust starts a server for any command: a command for
 * the whole server (the sleep delay) goes to these only.
 */
const liveServers = new Set<string>();
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
    liveServers.delete(event.account);
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
  // A visual's check names its server: a reloaded page reports there, even
  // for a chat it hasn't started again (`chatCommandFor`).
  if (event.type === "visual_check" && event.account)
    accountOf.set(chatId, event.account);
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

/** A forced close waits this long at most for its Claude Code to be gone. */
const FORCED_CLOSE_WAIT_MS = 10_000;

/**
 * Closes a chat at work (a forced account switch): its queued messages are
 * withdrawn first (their text comes back to the input, `queued_removed`),
 * its turn, shells and `!` commands stopped, then it waits for its
 * Claude Code to be gone (`closed`). Closing its input alone lets a turn
 * run on for seconds, the SDK kills it only 7 s later: the new pane would
 * resume the session under a Claude still at work on it.
 *
 * Never a `stop_task` for a subagent or a workflow (`tasks`): they die with
 * their Claude Code, and Claude takes a subagent up again in the resumed
 * session (SendMessage), as after a terminal's switch. Stopped by id, Claude
 * Code records an agent as stopped by the user (`stoppedByUser` in its
 * sidecar) and refuses every later message to it (measured on a subagent,
 * 12/11/2026). Left running, they keep their Claude Code alive for seconds:
 * the server says `closed` once the kit killed it (`closedDelayMs`).
 */
export async function stopAndCloseChat(
  accountId: string | undefined,
  chatId: string,
  queued: readonly string[],
): Promise<void> {
  const a = chatActivity(chatId);
  const send = (command: ChatCommand) =>
    chatCommand(accountId, command).catch(() => {});
  for (const uuid of queued)
    await send({ type: "cancel_queued", chatId, uuid });
  await Promise.all([
    send({ type: "interrupt", chatId }),
    ...a.shells.map((taskId) => send({ type: "stop_task", chatId, taskId })),
    ...a.bangs.map((id) => send({ type: "bash_stop", chatId, id })),
  ]);
  const gone = new Promise<void>((resolve) => {
    const done = () => {
      off();
      window.clearTimeout(timer);
      resolve();
    };
    const off = subscribeChat(chatId, (e) => {
      if (e.type === "closed") done();
    });
    const timer = window.setTimeout(done, FORCED_CLOSE_WAIT_MS);
  });
  await send({ type: "close", chatId });
  await gone;
  await new Promise((r) => setTimeout(r, CLOSE_GRACE_MS));
}

/**
 * The accounts whose server runs (`liveServers`), as `chatCommand` takes
 * them: never one that stopped, a command would start it again for nothing.
 */
export function liveServerAccounts(): (string | undefined)[] {
  return [...liveServers].map((key) => (key === "main" ? undefined : key));
}

/**
 * Whether the server that runs `chatId` runs now, as far as this page
 * knows: Rust starts a server for any command, so one for a chat never
 * started here, or whose server stopped, would start a server with no chat.
 */
export function chatServerLive(chatId: string): boolean {
  const account = accountOf.get(chatId);
  return account !== undefined && liveServers.has(account);
}

/** A command to the server that runs `chatId` (its start named the account). */
export function chatCommandFor(
  chatId: string,
  command: ChatCommand,
): Promise<void> {
  const account = accountOf.get(chatId);
  return chatCommand(account === "main" ? undefined : account, command);
}

export function chatCommand(
  accountId: string | undefined,
  command: ChatCommand,
  /**
   * Who sends it: the user at the PC by default, the phone (`chatCommand`
   * action), or Arkadia on its own (a « continue » after a usage limit).
   */
  from: "desktop" | "phone" | "auto" = "desktop",
): Promise<void> {
  // The user at the PC: a chat the phone drove goes back to the PC (no more
  // rings on the phone), as a terminal does on a key (`send_input`).
  if (from === "desktop" && command.chatId && desktopTakesBack(command.type))
    void invoke("remote_desktop_chat_input", { pane: command.chatId }).catch(
      () => {},
    );
  if (command.type === "start") {
    accountOf.set(command.chatId, accountId ?? "main");
    liveServers.add(accountId ?? "main");
    // A new Claude Code (« Reprendre ») starts at rest: nothing of the
    // last one's still counts. A reattach replays from `attached` anyway.
    setActivity(command.chatId, IDLE_CHAT);
  }
  return invoke("chat_command", { accountId: accountId ?? null, command });
}
