/** A point of the frozen artifact, as fractions (0 to 1) of its width and
 *  height: it stays on the same spot of the picture if the panel is resized
 *  mid-capture. */
export interface Point {
  x: number;
  y: number;
}

/** A region of the frozen artifact, in fractions like `Point`. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Below this, in CSS pixels, a press and release is a click, not a region. */
export const MIN_REGION = 4;

/** The pointer at `client` over the frozen artifact laid at `rect`. */
export function pointIn(
  client: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
): Point {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x: rect.width > 0 ? clamp((client.x - rect.left) / rect.width) : 0,
    y: rect.height > 0 ? clamp((client.y - rect.top) / rect.height) : 0,
  };
}

/** The rectangle between two corners. */
export function spanned(a: Point, b: Point): Region {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Whether `region`, on an artifact shown at `shown` size, is more than a click. */
export function isRegion(region: Region, shown: Size): boolean {
  return (
    region.width * shown.width >= MIN_REGION &&
    region.height * shown.height >= MIN_REGION
  );
}

/** `region` in the grab's own pixels (the screen's physical pixels). */
export function toGrabPixels(region: Region, grab: Size): Region {
  const x = Math.round(region.x * grab.width);
  const y = Math.round(region.y * grab.height);
  return {
    x,
    y,
    width: Math.round((region.x + region.width) * grab.width) - x,
    height: Math.round((region.y + region.height) * grab.height) - y,
  };
}

/** The pane a capture is pasted in: the tab's active pane when it is a
 *  Claude pane (one where Claude was started, as for the prompt bar), else the
 *  tab's first Claude pane. None without Claude: Alt+V would
 *  mean something else to another program, and the image stays on the
 *  clipboard. */
export function snipTarget(
  activePaneId: string | null,
  tabPaneIds: string[],
  claudePaneIds: ReadonlySet<string>,
): string | null {
  if (activePaneId && claudePaneIds.has(activePaneId)) return activePaneId;
  return tabPaneIds.find((id) => claudePaneIds.has(id)) ?? null;
}
