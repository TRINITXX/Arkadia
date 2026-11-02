import {
  chatCommand,
  chatEventsReady,
  SERVER_GONE,
  subscribeChat,
  subscribeServerExit,
} from "@/lib/chat/chatEvents";
import { messageDraft } from "@/lib/chat/chatAttachments";
import { putBackInDraft } from "@/lib/chat/chatDrafts";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { mayAutoResume, restartStart } from "@/lib/chat/chatRestart";
import { withdrawnItem } from "@/lib/chat/chatSdkSettings";
import { sleepAfter } from "@/lib/chat/chatSleep";
import {
  cutTurn,
  EMPTY_CHAT,
  reduceChat,
  type ChatItem,
  type ChatState,
} from "@/lib/chat/chatState";
import type { ChatStart } from "@/lib/chat/useChatSession";
import { reportChatUsage } from "@/lib/chat/chatUsageReport";

/**
 * Each chat's conversation, kept page-side across its pane's unmounts (a pane
 * unmounts whenever its project leaves the screen): it goes on hearing its
 * events, so a pane coming back shows it at once and starts nothing. Before
 * this, every return replayed the server's whole log through the reducer.
 * A page reload starts over: the server replays, and the replay builds
 * apart, the shown state swapped once it ends (`attached` … `replayed`).
 */

/**
 * Events come in bursts while Claude streams: they are folded in at most
 * every 16 ms. A timer rather than an animation frame: frames stop while the
 * window is minimized, and a long stream would pile up meanwhile.
 */
const FLUSH_MS = 16;

/** Where the column was: a row of it, how far its top sat above the view. */
export interface ColumnPlace {
  index: number;
  offset: number;
  stuck: boolean;
}

interface LiveChat {
  /** The pane's id too: its draft's key (`chatDrafts`). */
  chatId: string;
  accountId: string | undefined;
  state: ChatState;
  /** Subagent conversations opened from the drawer, by agent id. */
  agents: Record<string, ChatState>;
  /** A reattach's replay, built apart until `replayed`. */
  replay: ChatState | null;
  /** The replay holds a /clear: told once it shows (`subscribeLiveSessions`). */
  replayReset: boolean;
  queue: ChatEvent[];
  timer: ReturnType<typeof setTimeout> | undefined;
  listeners: Set<() => void>;
  off: () => void;
  column: ColumnPlace | null;
  /** How this page started it: a resume after its server stopped starts from it. */
  start: ChatStart | null;
  /** Its automatic resumes lately (`mayAutoResume`). */
  resumes: number[];
}

const NO_AGENTS: Record<string, ChatState> = {};
const chats = new Map<string, LiveChat>();

/** Told each chat's session as soon as it is known, its pane shown or not. */
const sessionListeners = new Set<
  (chatId: string, sessionId: string | null) => void
>();

/**
 * The pane keeps its chat's session (`PaneChat.resume`) from here, not from
 * its mounted view: a session known while the pane is unmounted must still
 * keep « Reprendre » from starting it a second time (`paneHolding`). Null
 * after /clear: none until the next message, a relaunch starts fresh. Only
 * a /clear says null: a relaunch empties the column for a moment too.
 */
export function subscribeLiveSessions(
  cb: (chatId: string, sessionId: string | null) => void,
): () => void {
  sessionListeners.add(cb);
  return () => sessionListeners.delete(cb);
}

function notify(chat: LiveChat, before?: ChatState, reset = false): void {
  for (const cb of chat.listeners) cb();
  const sessionId = chat.state.sessionId;
  const changed = before && sessionId && sessionId !== before.sessionId;
  const cleared = reset && sessionId === null;
  if (!changed && !cleared) return;
  const chatId = [...chats].find(([, c]) => c === chat)?.[0];
  if (chatId) for (const cb of sessionListeners) cb(chatId, sessionId);
}

const isReset = (event: ChatEvent) =>
  event.type === "sdk" && event.message.type === "conversation_reset";

/** A message withdrawn as the input had it: a command as typed. */
function draftOf(item: Extract<ChatItem, { kind: "user" | "command" }>) {
  if (item.kind === "user") return messageDraft(item.text, item.pasted);
  const text = `/${item.name}${item.args ? ` ${item.args}` : ""}`;
  return { text, images: [] };
}

function flush(chat: LiveChat): void {
  chat.timer = undefined;
  const batch = chat.queue;
  chat.queue = [];
  const now = Date.now();
  let state = chat.state;
  let replay = chat.replay;
  let reset = false;
  for (const event of batch) {
    if (event.type === "attached") {
      replay = reduceChat(EMPTY_CHAT, event, now);
      chat.replayReset = false;
      continue;
    }
    if (replay) {
      replay = reduceChat(replay, event, now);
      if (isReset(event)) chat.replayReset = true;
      // The end of the replay, or a server gone meanwhile: shown at once.
      if (event.type === "replayed" || event.type === "closed") {
        state = replay;
        replay = null;
        reset ||= chat.replayReset;
        chat.replayReset = false;
      }
      continue;
    }
    // Withdrawn by its × (never in a replay): back in the input.
    const back =
      event.type === "queued_removed"
        ? withdrawnItem(state.items, event.uuid)
        : null;
    state = reduceChat(state, event, now);
    if (isReset(event)) reset = true;
    if (back && !state.items.includes(back))
      putBackInDraft(chat.chatId, draftOf(back));
  }
  chat.replay = replay;
  if (state === chat.state) return;
  const before = chat.state;
  chat.state = state;
  if (state.limits !== before.limits)
    reportChatUsage(chat.accountId, before.limits, state.limits);
  notify(chat, before, reset);
}

function push(chat: LiveChat, event: ChatEvent): void {
  if (event.type === "history" && event.agentId) {
    chat.agents = {
      ...chat.agents,
      [event.agentId]: reduceChat(
        EMPTY_CHAT,
        { ...event, agentId: undefined },
        0,
      ),
    };
    notify(chat);
    return;
  }
  chat.queue.push(event);
  chat.timer ??= setTimeout(() => flush(chat), FLUSH_MS);
}

function open(chatId: string, accountId: string | undefined): LiveChat {
  const known = chats.get(chatId);
  if (known) return known;
  const chat: LiveChat = {
    chatId,
    accountId,
    state: EMPTY_CHAT,
    agents: NO_AGENTS,
    replay: null,
    replayReset: false,
    queue: [],
    timer: undefined,
    listeners: new Set(),
    off: () => {},
    column: null,
    start: null,
    resumes: [],
  };
  const offEvents = subscribeChat(chatId, (event) => push(chat, event));
  const offExit = subscribeServerExit((account) => {
    if (account === (chat.accountId ?? "main")) resumeAfterExit(chat);
  });
  chat.off = () => {
    offEvents();
    offExit();
    clearTimeout(chat.timer);
  };
  chats.set(chatId, chat);
  return chat;
}

/**
 * Its server stopped (crash, error): the chat starts again on its session
 * at once, no click, its column kept (`restartStart`). What ran is cut and
 * not run again, and the column says a turn was cut. A chat that had ended,
 * one this page never started, or a server that keeps dying
 * (`mayAutoResume`) waits for « Reprendre » as before.
 */
function resumeAfterExit(chat: LiveChat): void {
  // What came before the server went, folded first: the state as it was.
  if (chat.timer !== undefined) {
    clearTimeout(chat.timer);
    flush(chat);
  }
  const now = Date.now();
  const verdict = mayAutoResume(chat.resumes, now);
  chat.resumes = verdict.times;
  const start = chat.start;
  if (chat.state.closed || chat.replay || !start || !verdict.ok) {
    push(chat, { type: "closed", chatId: chat.chatId, error: SERVER_GONE });
    return;
  }
  const before = chat.state;
  chat.state = cutTurn(before, now);
  notify(chat, before);
  const chatId = chat.chatId;
  void chatEventsReady()
    .then(() =>
      chatCommand(chat.accountId, {
        type: "start",
        chatId,
        ...restartStart(before, start),
        sleepAfterMs: sleepAfter(),
      }),
    )
    .catch((e: unknown) =>
      push(chat, { type: "closed", chatId, error: String(e) }),
    );
}

/** The session a chat runs now, as far as this page heard. */
export function liveSessionId(chatId: string): string | null {
  return chats.get(chatId)?.state.sessionId ?? null;
}

export function liveChatState(chatId: string): ChatState {
  return chats.get(chatId)?.state ?? EMPTY_CHAT;
}

export function liveChatAgents(chatId: string): Record<string, ChatState> {
  return chats.get(chatId)?.agents ?? NO_AGENTS;
}

export function subscribeLiveChat(chatId: string, cb: () => void): () => void {
  const chat = chats.get(chatId);
  if (!chat) return () => {};
  chat.listeners.add(cb);
  return () => chat.listeners.delete(cb);
}

/**
 * The pane shows its chat: kept and listening from now on. True when it must
 * be started: never started on this page, or ended (a pane coming back to an
 * ended chat starts it again on its session, as it always did).
 */
export function attachLiveChat(
  chatId: string,
  accountId: string | undefined,
): boolean {
  const fresh = !chats.has(chatId);
  const chat = open(chatId, accountId);
  return fresh || chat.state.closed !== null;
}

/** Starts (or starts again) the chat from an empty column. */
export function startLiveChat(
  chatId: string,
  accountId: string | undefined,
  start: ChatStart,
): Promise<void> {
  const chat = open(chatId, accountId);
  clearTimeout(chat.timer);
  chat.timer = undefined;
  chat.queue = [];
  chat.replay = null;
  chat.state = EMPTY_CHAT;
  chat.agents = NO_AGENTS;
  chat.column = null;
  chat.start = start;
  notify(chat);
  return chatEventsReady()
    .then(() =>
      chatCommand(accountId, {
        type: "start",
        chatId,
        ...start,
        sleepAfterMs: sleepAfter(),
      }),
    )
    .catch((e: unknown) =>
      push(chat, { type: "closed", chatId, error: String(e) }),
    );
}

/** A change of the page's own (an error of a command) on the chat's state. */
export function updateLiveChat(
  chatId: string,
  update: (state: ChatState) => ChatState,
): void {
  const chat = chats.get(chatId);
  if (!chat) return;
  const next = update(chat.state);
  if (next === chat.state) return;
  chat.state = next;
  notify(chat);
}

/** The pane closed, or left for the terminal: its chat is forgotten. */
export function dropLiveChat(chatId: string): void {
  const chat = chats.get(chatId);
  if (!chat) return;
  chat.off();
  chats.delete(chatId);
}

export function rememberColumn(chatId: string, place: ColumnPlace): void {
  const chat = chats.get(chatId);
  if (chat) chat.column = place;
}

export function recallColumn(chatId: string): ColumnPlace | null {
  return chats.get(chatId)?.column ?? null;
}
