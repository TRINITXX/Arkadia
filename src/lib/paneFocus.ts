/**
 * Hands keyboard focus back to a terminal pane's DOM element. Distinct from
 * App's `focusPane`, which makes a pane the active one inside its tab.
 *
 * Deferred by a frame: callers run this right after an action that is still
 * unmounting an overlay or settling the DOM, and focusing before that lands
 * would be undone by React's own focus handling.
 */
export function focusPaneElement(paneId: string) {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`)?.focus();
  });
}
