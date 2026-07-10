/**
 * Race-safe, subscribe-once wrapper around Tauri's async `listen()`.
 *
 * Tauri's `listen()` resolves its unlisten function asynchronously. The naive
 * pattern (`unlisten = await listen(...)` in a React effect whose deps change
 * every render) leaks a live listener whenever the effect cleanup runs before
 * the promise resolves — the "zombie" keeps receiving every event and pins its
 * whole render closure in memory. At terminal-render frequency (~60 Hz per
 * active pane) those zombies accumulated for hours and grew the heap by
 * gigabytes.
 *
 * `subscribeStable` guards both sides: events are dropped after dispose, and a
 * registration that resolves *after* dispose is immediately unsubscribed.
 */

export type ListenFn = <T>(
  event: string,
  handler: (e: { payload: T }) => void,
) => Promise<() => void>;

/**
 * Subscribes `handler` to `event` via `listenFn`. Returns a dispose function
 * that is safe to call at any time — including before the underlying
 * registration has resolved.
 *
 * Callers that need fresh per-render state in the handler should read it
 * through a ref inside `handler` instead of resubscribing.
 */
export function subscribeStable<T>(
  listenFn: ListenFn,
  event: string,
  handler: (payload: T) => void,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listenFn<T>(event, (e) => {
    if (!disposed) handler(e.payload);
  }).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = undefined;
  };
}
