/**
 * A wheel handed to the conversation from outside it: over a visual (its
 * page sends the wheel up) or over the bottom (question sheet, input), which
 * sit outside the scroll area (the user's reports of 01/11/2026).
 */

/** A wheel line, as Chromium counts it. */
const LINE_PX = 40;

/** Share of the distance left a glide covers each frame. */
const GLIDE = 0.35;

/** A wheel's vertical delta in pixels (`deltaMode`: 0 px, 1 lines, 2 pages). */
export function wheelPixels(dy: number, mode: number, page: number): number {
  return dy * (mode === 1 ? LINE_PX : mode === 2 ? page : 1);
}

/** A scroller's glide under way: where it goes, its spot (fractional), what it wrote. */
interface Glide {
  target: number;
  pos: number;
  wrote: number;
}
const glides = new WeakMap<HTMLElement, Glide>();

/**
 * Scrolls `n` by `dy`, eased over a few frames as the wheel does natively.
 * Its spot stays fractional (Chromium writes whole pixels: a touchpad's
 * 1 px steps would never move), and any other write to the column (the
 * stick to the end, the user's own scroll) ends it at once, never fought.
 */
export function glideBy(n: HTMLElement, dy: number): void {
  const max = n.scrollHeight - n.clientHeight;
  const clamp = (v: number) => Math.max(0, Math.min(max, v));
  const on = glides.get(n);
  if (on && Math.abs(n.scrollTop - on.wrote) <= 1) {
    on.target = clamp(on.target + dy);
    return;
  }
  const glide: Glide = {
    target: clamp(n.scrollTop + dy),
    pos: n.scrollTop,
    wrote: n.scrollTop,
  };
  glides.set(n, glide);
  const step = () => {
    // Replaced by a newer glide, or the column moved by something else.
    if (glides.get(n) !== glide) return;
    if (Math.abs(n.scrollTop - glide.wrote) > 1) {
      glides.delete(n);
      return;
    }
    const left = glide.target - glide.pos;
    glide.pos = Math.abs(left) < 0.5 ? glide.target : glide.pos + left * GLIDE;
    n.scrollTop = Math.round(glide.pos);
    glide.wrote = n.scrollTop;
    // Arrived, or held at an edge (a column that shrank).
    if (
      glide.pos === glide.target ||
      Math.abs(n.scrollTop - Math.round(glide.pos)) > 1
    ) {
      glides.delete(n);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Whether an element between `from` and `stop` (excluded) scrolls itself
 * that way: a long input, the sheet's own list, a menu keep their wheel.
 */
export function scrollsItself(
  from: Element | null,
  stop: Element,
  dy: number,
): boolean {
  for (let n = from; n && n !== stop; n = n.parentElement) {
    const style = window.getComputedStyle(n);
    if (!/(auto|scroll)/.test(style.overflowY)) continue;
    const max = n.scrollHeight - n.clientHeight;
    if (max > 1 && (dy < 0 ? n.scrollTop > 0 : n.scrollTop < max - 1))
      return true;
  }
  return false;
}
