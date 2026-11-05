import { useSyncExternalStore } from "react";

/**
 * Which panes have a Chrome window Claude drives (`chrome_view.rs`), for the
 * « Chrome » chip under a chat's input, and how the chip shows or hides that
 * window in the panel. App keeps both up to date; the chips only read.
 */
const live = new Set<string>();
const listeners = new Set<() => void>();
let toggler: ((paneId: string) => void) | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

export function setChromePane(paneId: string, on: boolean): void {
  if (live.has(paneId) === on) return;
  if (on) live.add(paneId);
  else live.delete(paneId);
  notify();
}

/** Whether pane `paneId` has a Chrome window of Claude's. */
export function useChromePane(paneId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => live.has(paneId),
  );
}

export function setChromeToggler(fn: ((paneId: string) => void) | null): void {
  toggler = fn;
}

/** The chip's click: pane `paneId`'s Chrome in the panel, or out of it. */
export function toggleChromeOf(paneId: string): void {
  toggler?.(paneId);
}
