// Zoom/pan maths for the lightbox. The content is laid out centred in its
// stage and drawn with `translate(x, y) scale(scale)` around its own centre,
// so a screen point relative to the stage centre is `(x, y) + scale * local`.

export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

export const IDENTITY_VIEW: ZoomView = { scale: 1, x: 0, y: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 12;

/**
 * `view` zoomed by `factor` so that the point under the cursor stays put.
 * `(px, py)` is the cursor relative to the stage centre. Back at scale 1 the
 * offset is dropped: an unzoomed image always sits centred.
 */
export function zoomAt(
  view: ZoomView,
  factor: number,
  px: number,
  py: number,
): ZoomView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  if (scale === MIN_SCALE) return IDENTITY_VIEW;
  const ratio = scale / view.scale;
  return {
    scale,
    x: px - ratio * (px - view.x),
    y: py - ratio * (py - view.y),
  };
}
