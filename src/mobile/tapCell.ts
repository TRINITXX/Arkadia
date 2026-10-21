/** Finger or mouse travel past which a press is a drag, not a click. */
export const TAP_SLOP_PX = 8;

/**
 * The grid cell under a tap, from its offset in the text area (side padding
 * already removed). Null past the frame's last row or column: the frame may
 * still carry another screen's size, smaller than what this one shows.
 */
export function tapCell(
  x: number,
  y: number,
  cell: { width: number; height: number },
  frame: { cols: number; rows: number },
): { col: number; row: number } | null {
  const col = Math.max(0, Math.floor(x / cell.width));
  const row = Math.max(0, Math.floor(y / cell.height));
  return col < frame.cols && row < frame.rows ? { col, row } : null;
}
