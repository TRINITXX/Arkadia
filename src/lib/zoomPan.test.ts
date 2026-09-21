import { describe, expect, it } from "vitest";
import { IDENTITY_VIEW, MAX_SCALE, zoomAt } from "./zoomPan";

/** Where the local point under `(px, py)` lands on screen after `view`. */
function screenOf(
  view: { scale: number; x: number; y: number },
  local: [number, number],
) {
  return [view.x + view.scale * local[0], view.y + view.scale * local[1]];
}

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const start = { scale: 2, x: 30, y: -10 };
    const cursor: [number, number] = [120, 80];
    const local: [number, number] = [
      (cursor[0] - start.x) / start.scale,
      (cursor[1] - start.y) / start.scale,
    ];
    const next = zoomAt(start, 1.5, cursor[0], cursor[1]);
    expect(next.scale).toBe(3);
    const [sx, sy] = screenOf(next, local);
    expect(sx).toBeCloseTo(cursor[0]);
    expect(sy).toBeCloseTo(cursor[1]);
  });

  it("recentres when zoomed back out to 1", () => {
    expect(zoomAt({ scale: 1.2, x: 40, y: 40 }, 0.5, 10, 10)).toEqual(
      IDENTITY_VIEW,
    );
  });

  it("clamps at the maximum scale", () => {
    expect(zoomAt(IDENTITY_VIEW, 100, 0, 0).scale).toBe(MAX_SCALE);
  });
});
