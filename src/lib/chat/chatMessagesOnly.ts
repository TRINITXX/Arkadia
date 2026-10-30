import { useCallback, useSyncExternalStore } from "react";

/**
 * Each chat pane's « Messages seuls » switch, outside React like its draft
 * (`chatDrafts`): a pane unmounts when its project leaves the screen and
 * comes back as it was left. Off unless listed.
 */

const on = new Set<string>();
const listeners = new Set<() => void>();

export function isMessagesOnly(paneId: string): boolean {
  return on.has(paneId);
}

export function setMessagesOnly(paneId: string, value: boolean): void {
  if (value === on.has(paneId)) return;
  if (value) on.add(paneId);
  else on.delete(paneId);
  for (const cb of listeners) cb();
}

/** A pane relaunched under a new id (account switch) keeps its switch. */
export function moveMessagesOnly(fromId: string, toId: string): void {
  if (!on.has(fromId)) return;
  setMessagesOnly(fromId, false);
  setMessagesOnly(toId, true);
}

/** A pane that closes forgets it. */
export function dropMessagesOnly(paneId: string): void {
  setMessagesOnly(paneId, false);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePaneMessagesOnly(
  paneId: string,
): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => on.has(paneId));
  const update = useCallback(
    (v: boolean) => setMessagesOnly(paneId, v),
    [paneId],
  );
  return [value, update];
}
