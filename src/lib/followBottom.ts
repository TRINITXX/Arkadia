/**
 * Whether the reading view keeps following the end of the conversation after
 * a scroll event. Only the user scrolling up leaves the bottom: content that
 * grows below the viewport (rows sized in by `content-visibility`, images
 * decoding, a delta landing) never moves `scrollTop`, so judging by the gap
 * alone unpinned the view in the very frame those rows grew, and it stayed
 * stranded on a message far above the end.
 */

/** Gap under the viewport (px) within which scrolling down resumes following. */
export const FOLLOW_ZONE_PX = 80;

/**
 * A list growth this soon (ms) after a press in it is something unfolding
 * under the pointer (tool cards open in 140 ms), not new content.
 */
export const UNFOLD_WINDOW_MS = 400;

/** Below this gap (px) the view is at the bottom, sub-pixel rounding aside. */
const AT_BOTTOM_PX = 2;

/**
 * `top` is the new `scrollTop`, `lastTop` the previous one (scroll event or
 * programmatic stick), `gap` what is left to scroll below the viewport.
 * `resumeZone` is 0 while a search jump owns the scroll, so its animation
 * ending near the end does not hand the view back to the follower.
 */
export function followsAfterScroll(
  following: boolean,
  top: number,
  lastTop: number,
  gap: number,
  resumeZone = FOLLOW_ZONE_PX,
): boolean {
  if (gap <= AT_BOTTOM_PX) return true;
  // Any step up leaves, however small: a slow trackpad or touch drag moves
  // under a pixel per frame. A clamp from shrinking content lands at gap 0.
  if (following) return top >= lastTop;
  return top > lastTop && gap < resumeZone;
}
