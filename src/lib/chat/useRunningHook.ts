import { useEffect, useState } from "react";
import type { RunningHook } from "@/lib/chat/chatSdkSettings";

/** Most hooks end within this: the live line names only one that lasts. */
export const HOOK_SHOW_MS = 800;

/** The hook the live line names at `now`: the oldest running long enough. */
export function slowHook(hooks: RunningHook[], now: number): string | null {
  const hook = hooks.find((h) => now - h.startedAt >= HOOK_SHOW_MS);
  return hook?.name ?? null;
}

/**
 * The name of a hook that has been running a while, else null: a quick one
 * would only flash in the live line. Rendered again when the oldest crosses
 * the threshold.
 */
export function useRunningHook(hooks: RunningHook[]): string | null {
  const [now, setNow] = useState(() => Date.now());
  const shown = slowHook(hooks, now);
  const first = hooks[0]?.startedAt;
  useEffect(() => {
    if (first === undefined) return;
    const wait = first + HOOK_SHOW_MS - Date.now();
    if (wait <= 0) {
      setNow(Date.now());
      return;
    }
    const id = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(id);
  }, [first]);
  return shown;
}
