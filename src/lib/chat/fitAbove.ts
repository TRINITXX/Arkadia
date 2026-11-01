/** Room kept between a menu's top and its pane's. */
const MARGIN_PX = 8;

/**
 * A menu opening upward, told the room above it in its pane (`--room`, its
 * CSS caps `max-height` with it): a low pane clips what overflows, so its
 * top would be cut and its first entries out of reach; the rest scrolls.
 */
export function fitAbove(el: HTMLElement | null): void {
  const pane = el?.closest(".chat-root");
  if (!el || !pane) return;
  const room =
    el.getBoundingClientRect().bottom -
    pane.getBoundingClientRect().top -
    MARGIN_PX;
  el.style.setProperty("--room", `${Math.max(0, Math.floor(room))}px`);
}
