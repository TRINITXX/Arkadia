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

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { RenderPayload } from "@/types";
import { holdPaneShown } from "@/lib/shownPanes";

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
  desktopSizes.delete(paneId);
}

// The grid each desktop pane last gave its PTY. A phone watching a pane
// resizes it to its own screen; the desktop takes it back on the next touch.
const desktopSizes = new Map<string, { cols: number; rows: number }>();

export function rememberDesktopSize(
  paneId: string,
  cols: number,
  rows: number,
): void {
  desktopSizes.set(paneId, { cols, rows });
}

/** The desktop's size for `paneId` when the PTY no longer has it, else null. */
export function sizeToReclaim(
  paneId: string,
): { cols: number; rows: number } | null {
  const want = desktopSizes.get(paneId);
  const frame = frames.get(paneId);
  if (!want || !frame) return null;
  return frame.cols === want.cols && frame.rows === want.rows ? null : want;
}

/** The frame a pane last displayed, kept while it is hidden. */
export interface HeldFrame {
  paneId: string;
  frame: RenderPayload | null;
}

/**
 * What a pane displays: the latest frame while live; while hidden, the frame it
 * last displayed. A hidden pane still re-renders with its parent — every title
 * change of any session re-renders the app — and reading the latest frame then
 * redrew every hidden terminal each time: 23% of the page's CPU samples with
 * fifteen busy sessions (measured 24/10/2026).
 */
export function displayedFrame(
  held: { current: HeldFrame | null },
  paneId: string,
  live: boolean,
): RenderPayload | null {
  if (live || held.current?.paneId !== paneId) {
    held.current = { paneId, frame: getFrame(paneId) };
  }
  return held.current.frame;
}

/**
 * The live frame of a pane. When `live` is false (pane hidden), the
 * subscription is suspended and the frame stays the one last displayed; on
 * re-show the snapshot immediately serves the latest frame. A live pane is
 * also declared on screen, which keeps its frames at full rate (see
 * `shownPanes`).
 */
export function usePaneFrame(
  paneId: string,
  live: boolean = true,
): RenderPayload | null {
  useEffect(() => (live ? holdPaneShown(paneId) : undefined), [paneId, live]);
  const held = useRef<HeldFrame | null>(null);
  const subscribe = useCallback(
    (cb: () => void) => (live ? subscribeFrame(paneId, cb) : () => {}),
    [paneId, live],
  );
  return useSyncExternalStore(subscribe, () =>
    displayedFrame(held, paneId, live),
  );
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
