/**
 * Subscription to the backend popup queue (`popup-state` events), shared by the
 * notification windows (PopupApp / NotifApp).
 *
 * The one rule this module encodes: `popup_request_state` must be invoked only
 * AFTER the `popup-state` listener is registered. The initial `emit_state` at
 * window creation always lands before the webview's JS is loaded, so the
 * request/response pair is the window's ONLY way to learn the queue — if the
 * response is emitted before the listener exists, the event is lost and the
 * window freezes on "Conversation introuvable".
 *
 * Deliberately Tauri-free (deps are injected) so it's testable under plain Node,
 * like durableStore.
 */

export interface PopupStateOptions<TItem> {
  /** Register the popup-state handler; resolves with the unlisten fn. */
  listen: (handler: (items: TItem[]) => void) => Promise<() => void>;
  /** Ask the backend to re-emit the current queue (`popup_request_state`). */
  requestState: () => Promise<unknown>;
  onItems: (items: TItem[]) => void;
}

/** Returns a dispose fn; safe to call before the listener finished registering. */
export function subscribePopupState<TItem>(
  opts: PopupStateOptions<TItem>,
): () => void {
  let active = true;
  let unlisten: (() => void) | undefined;
  opts
    .listen((items) => {
      if (active) opts.onItems(items);
    })
    .then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlisten = fn;
      // Listener registered — NOW the response event can't be missed.
      return opts.requestState();
    })
    .catch(() => {
      // A failed request isn't fatal: live queue changes still emit events.
    });
  return () => {
    active = false;
    unlisten?.();
  };
}
