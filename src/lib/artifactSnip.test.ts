import { describe, it, expect } from "vitest";
import {
  isRegion,
  pointIn,
  snipTarget,
  spanned,
  toGrabPixels,
} from "@/lib/artifactSnip";

describe("artifact snip", () => {
  it("reads the pointer as fractions of the artifact, kept inside it", () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    expect(pointIn({ x: 150, y: 75 }, rect)).toEqual({ x: 0.25, y: 0.25 });
    expect(pointIn({ x: 400, y: 0 }, rect)).toEqual({ x: 1, y: 0 });
  });

  it("spans two corners in any order", () => {
    expect(spanned({ x: 0.75, y: 0.5 }, { x: 0.25, y: 0.75 })).toEqual({
      x: 0.25,
      y: 0.5,
      width: 0.5,
      height: 0.25,
    });
  });

  it("takes a click for a corner, not a region", () => {
    const shown = { width: 400, height: 200 };
    expect(isRegion({ x: 0, y: 0, width: 0.005, height: 0.5 }, shown)).toBe(
      false,
    );
    expect(isRegion({ x: 0, y: 0, width: 0.01, height: 0.02 }, shown)).toBe(
      true,
    );
  });

  it("maps a region to the grab's physical pixels", () => {
    const region = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };
    expect(toGrabPixels(region, { width: 600, height: 400 })).toEqual({
      x: 150,
      y: 200,
      width: 300,
      height: 100,
    });
    // A region reaching the right edge ends on the grab's last pixel.
    const edge = { x: 1 / 3, y: 0, width: 2 / 3, height: 1 };
    expect(toGrabPixels(edge, { width: 100, height: 10 })).toEqual({
      x: 33,
      y: 0,
      width: 67,
      height: 10,
    });
  });

  it("pastes in the active pane, else the tab's Claude, never elsewhere", () => {
    const claude = new Set(["b", "c"]);
    expect(snipTarget("c", ["a", "b", "c"], claude)).toBe("c");
    expect(snipTarget("a", ["a", "b", "c"], claude)).toBe("b");
    expect(snipTarget("a", ["a"], claude)).toBeNull();
  });
});
