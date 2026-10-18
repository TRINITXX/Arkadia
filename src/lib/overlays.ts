import { useEffect, useSyncExternalStore } from "react";

/**
 * Layers of the main window that are open right now (dialogs, menus, the
 * image viewer, the notepad). The artifact panel's page is a separate window
 * that covers anything under it, so it steps aside while one is open.
 * Every layer that can reach the right edge of the window calls `useOverlay`.
 */
let openCount = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Counts the calling layer as open while `active` and mounted. */
export function useOverlay(active = true): void {
  useEffect(() => {
    if (!active) return;
    openCount += 1;
    notify();
    return () => {
      openCount -= 1;
      notify();
    };
  }, [active]);
}

export function useAnyOverlayOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openCount > 0,
  );
}
