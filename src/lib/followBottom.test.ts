import { describe, it, expect } from "vitest";
import { FOLLOW_ZONE_PX, followsAfterScroll } from "@/lib/followBottom";

describe("followsAfterScroll", () => {
  it("keeps following when rows grow under a pin that just landed", () => {
    // Pinned at 1000, then the bottom rows rendered 2000px taller.
    expect(followsAfterScroll(true, 1000, 500, 2000)).toBe(true);
  });

  it("stops following as soon as the user scrolls up", () => {
    expect(followsAfterScroll(true, 990, 1000, 10)).toBe(false);
  });

  it("stops following on a sub-pixel step up (slow drag)", () => {
    expect(followsAfterScroll(true, 999.5, 1000, 3)).toBe(false);
  });

  it("keeps following when shrinking content clamps the offset", () => {
    expect(followsAfterScroll(true, 800, 1000, 0)).toBe(true);
  });

  it("does not resume while the user keeps scrolling up near the end", () => {
    expect(followsAfterScroll(false, 960, 980, 40)).toBe(false);
  });

  it("resumes when the user scrolls back down into the zone", () => {
    expect(followsAfterScroll(false, 960, 900, FOLLOW_ZONE_PX - 1)).toBe(true);
    expect(followsAfterScroll(false, 960, 900, FOLLOW_ZONE_PX)).toBe(false);
  });

  it("does not resume in the zone while a search jump owns the scroll", () => {
    expect(followsAfterScroll(false, 960, 900, 40, 0)).toBe(false);
    expect(followsAfterScroll(false, 960, 900, 0, 0)).toBe(true);
  });

  it("resumes once at the very bottom, whichever the direction", () => {
    expect(followsAfterScroll(false, 800, 1000, 0)).toBe(true);
  });
});
