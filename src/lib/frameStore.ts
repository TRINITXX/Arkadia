/**
 * Module-level store for terminal frames, keyed by pane id.
 *
 * `terminal-render` events land here (App.tsx publishes them) instead of in
 * React state: routing every ~60 Hz frame through `setTabs` re-rendered the
 * whole orchestrator per frame per active pane. Terminal components subscribe
 * to their own pane only (via `usePaneFrame`), so a frame re-renders exactly
 * the pane it belongs to — and a hidden pane with no subscriber costs nothing
 * beyond a map write.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { RenderPayload } from "@/types";

const frames = new Map<string, RenderPayload>();
const listeners = new Map<string, Set<() => void>>();

/** Stores a pane's latest frame and wakes that pane's subscribers. */
export function publishFrame(payload: RenderPayload): void {
  frames.set(payload.session_id, payload);
  const subs = listeners.get(payload.session_id);
  if (subs) for (const cb of subs) cb();
}

/** The latest frame for a pane, or null before its first render event. */
export function getFrame(paneId: string): RenderPayload | null {
  return frames.get(paneId) ?? null;
}

export function subscribeFrame(paneId: string, cb: () => void): () => void {
  let set = listeners.get(paneId);
  if (!set) {
    set = new Set();
    listeners.set(paneId, set);
  }
  set.add(cb);
  return () => {
    const s = listeners.get(paneId);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) listeners.delete(paneId);
  };
}

/** Forgets a closed pane's frame and subscribers. */
export function dropFrame(paneId: string): void {
  frames.delete(paneId);
  listeners.delete(paneId);
}

/**
 * The live frame of a pane. When `live` is false (pane hidden), the
 * subscription is suspended: no re-render per frame; on re-show the snapshot
 * immediately serves the latest frame.
 */
export function usePaneFrame(
  paneId: string,
  live: boolean = true,
): RenderPayload | null {
  const subscribe = useCallback(
    (cb: () => void) => (live ? subscribeFrame(paneId, cb) : () => {}),
    [paneId, live],
  );
  return useSyncExternalStore(subscribe, () => getFrame(paneId));
}

/**
 * A cheap derived value of a pane's frame. Re-renders only when the selected
 * value changes (`Object.is`), not on every frame — e.g. the footer row count.
 */
export function usePaneFrameSelector<T>(
  paneId: string,
  selector: (frame: RenderPayload | null) => T,
): T {
  const subscribe = useCallback(
    (cb: () => void) => subscribeFrame(paneId, cb),
    [paneId],
  );
  return useSyncExternalStore(subscribe, () => selector(getFrame(paneId)));
}
