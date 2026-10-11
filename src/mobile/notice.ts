import { useSyncExternalStore } from "react";

/** A short message at the bottom of the screen (an action that failed). */
const NOTICE_MS = 4000;

let notice: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

function set(next: string | null) {
  notice = next;
  for (const cb of subs) cb();
}

export function showNotice(text: string) {
  if (timer) clearTimeout(timer);
  set(text);
  timer = setTimeout(() => set(null), NOTICE_MS);
}

export function useNotice(): string | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => notice,
  );
}
