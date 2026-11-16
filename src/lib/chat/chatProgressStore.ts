import { useCallback, useSyncExternalStore } from "react";
import {
  chatProgress,
  sameProgress,
  type ChatProgress,
} from "@/lib/chat/chatProgress";
import type { ChatState } from "@/lib/chat/chatState";

/**
 * Each chat's progress line, by chat (pane) id, for the sidebar: the chat
 * kept page-side (`chatLive`) publishes its state on every change, its pane
 * shown or not, and only a tab's own line renders when its summary changes.
 * A chat this page never attached (another project's after a reload, one
 * opened asleep) has none.
 */

const progress = new Map<string, ChatProgress>();
const listeners = new Map<string, Set<() => void>>();

function notify(chatId: string): void {
  for (const cb of listeners.get(chatId) ?? []) cb();
}

export function publishChatProgress(chatId: string, state: ChatState): void {
  const next = chatProgress(state);
  if (sameProgress(progress.get(chatId) ?? null, next)) return;
  if (next) progress.set(chatId, next);
  else progress.delete(chatId);
  notify(chatId);
}

/** The chat is forgotten (its pane closed, or back to the terminal). */
export function dropChatProgress(chatId: string): void {
  if (progress.delete(chatId)) notify(chatId);
}

export function useChatProgress(chatId: string | null): ChatProgress | null {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!chatId) return () => {};
      let set = listeners.get(chatId);
      if (!set) {
        set = new Set();
        listeners.set(chatId, set);
      }
      set.add(cb);
      return () => {
        const s = listeners.get(chatId);
        s?.delete(cb);
        if (s?.size === 0) listeners.delete(chatId);
      };
    },
    [chatId],
  );
  return useSyncExternalStore(subscribe, () =>
    chatId ? (progress.get(chatId) ?? null) : null,
  );
}

/**
 * The lines' clock: one timer for them all, every 30 s while a line shows,
 * so their times move without the app rendering.
 */
const TICK_MS = 30_000;
let now = Date.now();
const ticking = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(cb: () => void): () => void {
  ticking.add(cb);
  if (timer === undefined) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of ticking) l();
    }, TICK_MS);
  }
  return () => {
    ticking.delete(cb);
    if (ticking.size > 0 || timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };
}

/** Epoch ms, moved every 30 s. */
export function useProgressClock(): number {
  return useSyncExternalStore(subscribeClock, () => now);
}
