/**
 * Reveal logic for the floating prompt bar: the bar shows only while the cursor
 * is within `zone` pixels of the pane's bottom edge, so at rest the terminal
 * keeps its full height and nothing is covered.
 */

/** Pixels above the pane's bottom edge within which the bar reveals. */
export const REVEAL_ZONE_PX = 56;

/** True when `clientY` sits within `zone` px of the rect's bottom edge (and inside it horizontally). */
export function isNearBottom(
  rect: DOMRect,
  clientX: number,
  clientY: number,
  zone: number,
): boolean {
  if (clientX < rect.left || clientX > rect.right) return false;
  return clientY >= rect.bottom - zone && clientY <= rect.bottom;
}
