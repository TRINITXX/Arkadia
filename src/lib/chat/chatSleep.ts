import { useSyncExternalStore } from "react";
import { DEFAULT_SLEEP_MS, SLEEP_CHOICES } from "@chat-server/sleep";
import { chatCommand, liveServerAccounts } from "@/lib/chat/chatEvents";

/**
 * The Lab's setting: how long a chat stays idle before its Claude Code goes
 * to sleep (`chat-server/sleep.ts`). Kept in the page's storage, carried by
 * every chat's start, and sent to the running servers when it changes.
 */

const KEY = "arkadia.chat.sleepAfterMs";
/** What « never » is stored as. */
const NEVER = "never";

/** The stored value read back: one of the choices, else the default. */
export function parseSleepAfter(raw: string | null): number | null {
  if (raw === NEVER) return null;
  const ms = Number(raw);
  return SLEEP_CHOICES.includes(ms) ? ms : DEFAULT_SLEEP_MS;
}

/** « 15 min », « 1 h », « Jamais ». */
export function sleepChoiceLabel(ms: number | null): string {
  if (ms === null) return "Jamais";
  const min = Math.round(ms / 60_000);
  return min % 60 === 0 ? `${min / 60} h` : `${min} min`;
}

const store: Storage | null =
  typeof localStorage === "undefined" ? null : localStorage;

function read(): number | null {
  try {
    return parseSleepAfter(store?.getItem(KEY) ?? null);
  } catch {
    return DEFAULT_SLEEP_MS;
  }
}

let current = read();
const listeners = new Set<() => void>();

/** The delay now: every chat's start carries it. */
export function sleepAfter(): number | null {
  return current;
}

export function setSleepAfter(ms: number | null): void {
  if (ms === current) return;
  current = ms;
  try {
    store?.setItem(KEY, ms === null ? NEVER : String(ms));
  } catch {
    // Storage full or off: the choice holds until the page reloads.
  }
  for (const cb of listeners) cb();
  // Each running server, once: the setting is the whole server's (no chat).
  for (const account of liveServerAccounts()) {
    void chatCommand(account, { type: "sleep_after", chatId: "", ms }).catch(
      () => {},
    );
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The setting and its setter, for the settings' section. */
export function useSleepAfter(): [number | null, (ms: number | null) => void] {
  const value = useSyncExternalStore(subscribe, sleepAfter);
  return [value, setSleepAfter];
}
