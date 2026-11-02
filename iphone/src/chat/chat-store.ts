/**
 * The chats the app shows, built from the events the PC relays (`chat` on the
 * socket) with the desktop's own reducer (`foldPhoneChat`). Module store, as
 * `connection`: a chat kept after its screen closed shows at once when it
 * opens again, then catches up.
 */

import { AppState } from "react-native";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { withdrawnItem } from "@/lib/chat/chatSdkSettings";
import { SERVER_GONE } from "@/lib/chat/phoneChat";
import type { ChatState } from "@/lib/chat/chatState";
import {
  foldPhoneChat,
  NEW_PHONE_CHAT,
  type PhoneChatLive,
} from "@/lib/chat/phoneChatFold";
import {
  NEW_PHONE_WATCH,
  watchPhoneChat,
  type PhoneChatFeel,
  type PhoneChatWatch,
} from "@/lib/chat/phoneChatFeel";
import { putInComposer } from "~/chat/composer-inbox";
import {
  act,
  onChatCatchUp,
  onChatEvent,
  shownChatId,
} from "~/remote/connection";
import { failure, success, warning } from "~/ui/haptics";

/**
 * Events come in bursts while Claude writes: folded in at most this often.
 * Longer than the desktop's 16 ms: a phone re-renders slower, and a reply
 * written word by word reads the same at this pace.
 */
const FLUSH_MS = 40;
/** A chat server stopped: the page resumes its chats, then this phone catches up. */
const AFTER_SERVER_EXIT_MS = 2500;
/** A catch-up asked and not replayed yet after this: a new one may go. */
const CATCH_UP_WAIT_MS = 15_000;

interface Entry {
  live: PhoneChatLive;
  queue: ChatEvent[];
  timer: ReturnType<typeof setTimeout> | undefined;
  subs: Set<() => void>;
  /** When this phone last asked for its replay, until it starts (`attached`). */
  catchingUp: number;
  /** Queued messages this phone withdrew: their text comes back to its input. */
  withdrawing: Set<string>;
  /** Claude's ends and asks already felt, its replays aside (`watchPhoneChat`). */
  watch: PhoneChatWatch;
}

const chats = new Map<string, Entry>();

function entry(chatId: string): Entry {
  let e = chats.get(chatId);
  if (!e) {
    e = {
      live: NEW_PHONE_CHAT,
      queue: [],
      timer: undefined,
      subs: new Set(),
      catchingUp: 0,
      withdrawing: new Set(),
      watch: NEW_PHONE_WATCH,
    };
    chats.set(chatId, e);
  }
  return e;
}

function notify(e: Entry) {
  for (const cb of e.subs) cb();
}

function flush(e: Entry, chatId: string) {
  e.timer = undefined;
  const batch = e.queue;
  e.queue = [];
  // Withdrawn from here (its ×): its text back in this phone's input, as the
  // desktop puts it back in its own (the page leaves this one alone).
  for (const event of batch) {
    if (event.type !== "queued_removed" || !e.withdrawing.delete(event.uuid))
      continue;
    const item = withdrawnItem(e.live.state.items, event.uuid);
    if (item?.kind === "user") putInComposer(chatId, item.text);
    else if (item?.kind === "command")
      putInComposer(chatId, `/${item.name}${item.args ? ` ${item.args}` : ""}`);
  }
  // The replay asked started, or the chat isn't running: done either way.
  if (batch.some((ev) => ev.type === "attached" || ev.type === "closed"))
    e.catchingUp = 0;
  const now = Date.now();
  const { watch, feel } = watchPhoneChat(e.watch, batch, now);
  e.watch = watch;
  const { chat, catchUp: behind } = foldPhoneChat(e.live, batch, now);
  if (behind) catchUp(chatId);
  if (chat !== e.live) {
    e.live = chat;
    notify(e);
  }
  // With the screen told: the buzz comes with what it shows.
  if (feel) feelChat(chatId, feel);
}

/**
 * Claude done or asking, felt in the hand (Alexis's choice of 02/11/2026):
 * only for the chat on screen, the app in front.
 */
function feelChat(chatId: string, feel: PhoneChatFeel) {
  if (chatId !== shownChatId() || AppState.currentState !== "active") return;
  if (feel === "ask") warning();
  else if (feel === "failed") failure();
  else success();
}

/**
 * Its life replayed to this phone, without starting it (`chatOpen`): once
 * until that replay starts. Its server gone, it shows ended, with
 * « Reprendre »; any other failure (offline, no answer) waits for the next
 * catch-up, the chat as it was.
 */
export function catchUp(chatId: string) {
  const e = entry(chatId);
  if (Date.now() - e.catchingUp < CATCH_UP_WAIT_MS) return;
  e.catchingUp = Date.now();
  act({ kind: "chatOpen", chatId, restart: false }).catch((err: unknown) => {
    e.catchingUp = 0;
    if (err instanceof Error && err.message === SERVER_GONE)
      push(chatId, { type: "closed", chatId, error: SERVER_GONE });
  });
}

function push(chatId: string, event: ChatEvent) {
  const e = chats.get(chatId);
  if (!e) return;
  e.queue.push(event);
  e.timer ??= setTimeout(() => flush(e, chatId), FLUSH_MS);
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  onChatEvent((event) => {
    if (event.type === "server_exit") {
      const chatId = shownChatId();
      if (chatId) setTimeout(() => catchUp(chatId), AFTER_SERVER_EXIT_MS);
      return;
    }
    if ("chatId" in event && event.chatId) push(event.chatId, event);
  });
  onChatCatchUp((chatId) => {
    // Whatever was asked before the stream stopped is stale now.
    entry(chatId).catchingUp = 0;
    catchUp(chatId);
  });
}

/** A chat about to show: kept, and listened to. */
export function keepChat(chatId: string) {
  listen();
  entry(chatId);
}

/** This phone withdraws a queued message: its text comes back here. */
export function markWithdrawing(chatId: string, uuid: string) {
  entry(chatId).withdrawing.add(uuid);
}

export function chatLive(chatId: string): PhoneChatLive {
  return chats.get(chatId)?.live ?? NEW_PHONE_CHAT;
}

export function chatState(chatId: string): ChatState {
  return chatLive(chatId).state;
}

export function subscribeChat(chatId: string, cb: () => void): () => void {
  const e = entry(chatId);
  e.subs.add(cb);
  return () => {
    e.subs.delete(cb);
  };
}

/** A change of the app's own (an error of a command) on the chat's state. */
export function updateChat(
  chatId: string,
  update: (state: ChatState) => ChatState,
) {
  const e = chats.get(chatId);
  if (!e) return;
  const state = update(e.live.state);
  if (state === e.live.state) return;
  e.live = { ...e.live, state };
  notify(e);
}
