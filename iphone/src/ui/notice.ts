import { useSyncExternalStore } from "react";

const SHOWN_MS = 2600;

let notice: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

function set(next: string | null) {
  notice = next;
  for (const cb of subs) cb();
}

/** A short message over the app, gone after a moment. */
export function showNotice(message: string) {
  if (timer) clearTimeout(timer);
  set(message);
  timer = setTimeout(() => set(null), SHOWN_MS);
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
