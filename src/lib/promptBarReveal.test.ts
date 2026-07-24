import { describe, it, expect } from "vitest";
import { isNearBottom, REVEAL_ZONE_PX } from "@/lib/promptBarReveal";

const rect = (over: Partial<DOMRect> = {}): DOMRect =>
  ({
    left: 100,
    right: 500,
    top: 0,
    bottom: 400,
    x: 100,
    y: 0,
    width: 400,
    height: 400,
    toJSON: () => ({}),
    ...over,
  }) as DOMRect;

describe("isNearBottom", () => {
  const zone = REVEAL_ZONE_PX;

  it("reveals inside the bottom zone", () => {
    expect(isNearBottom(rect(), 300, 400 - zone + 1, zone)).toBe(true);
    expect(isNearBottom(rect(), 300, 399, zone)).toBe(true);
  });

  it("hides above the zone", () => {
    expect(isNearBottom(rect(), 300, 400 - zone - 1, zone)).toBe(false);
    expect(isNearBottom(rect(), 300, 0, zone)).toBe(false);
  });

  it("includes the exact bottom edge but nothing below it", () => {
    expect(isNearBottom(rect(), 300, 400, zone)).toBe(true);
    expect(isNearBottom(rect(), 300, 401, zone)).toBe(false);
  });

  it("respects horizontal bounds", () => {
    expect(isNearBottom(rect(), 99, 399, zone)).toBe(false);
    expect(isNearBottom(rect(), 501, 399, zone)).toBe(false);
    expect(isNearBottom(rect(), 100, 399, zone)).toBe(true);
    expect(isNearBottom(rect(), 500, 399, zone)).toBe(true);
  });
});
