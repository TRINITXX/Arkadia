/**
 * Which rows of a conversation the modern view draws. Every pane mounts its
 * view, so a project switch drew every row of every tab at once: 5,130 blocks
 * for one 167 MB session froze the page for seconds (27/10/2026). Only the
 * end is drawn at first; older rows come as the view nears the top.
 */

/** Rows drawn when a conversation opens, and added per step back. */
export const ROW_WINDOW = 50;

/** Older rows are drawn once the view is this close to the top (px). */
export const LOAD_OLDER_PX = 1500;

/**
 * First row to draw out of `total`: the held `start`, or the last
 * `ROW_WINDOW` rows when none is held yet. Never so late that fewer than
 * `ROW_WINDOW` rows remain, which a transcript rewrite could otherwise cause.
 */
export function firstDrawnRow(start: number | null, total: number): number {
  const tail = Math.max(0, total - ROW_WINDOW);
  return start === null ? tail : Math.min(start, tail);
}

/** The first row once the view asks for older ones. */
export function olderStart(first: number): number {
  return Math.max(0, first - ROW_WINDOW);
}

/**
 * How far to move the view down once older rows went in above the reader,
 * who stood at `before` when asking; the offset is now `now` and the content
 * grew by `grown`. Chromium's scroll anchoring has already moved the offset
 * by about `grown`: nothing to add. From offset 0, or on Safari before 27,
 * the offset only moved with the reader's own scrolling (a fling goes on
 * while the rows render): add `grown` on top, keeping that motion. A row is
 * 90 px or more, so half the growth tells the two cases apart.
 */
export function prependCorrection(
  before: number,
  now: number,
  grown: number,
): number {
  if (grown <= 0) return 0;
  return now - before < grown / 2 ? grown : 0;
}
