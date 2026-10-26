import { describe, expect, it } from "vitest";
import { claimEnter, railTakesKey } from "./railEnter";

const CR = new Uint8Array([0x0d]);

describe("railTakesKey", () => {
  it("asks the pane's rail, and lets the key through without one", () => {
    expect(railTakesKey("a", CR)).toBe(false);
    const release = claimEnter("a", () => true);
    expect(railTakesKey("a", CR)).toBe(true);
    expect(railTakesKey("b", CR)).toBe(false);
    release();
    expect(railTakesKey("a", CR)).toBe(false);
  });

  it("offers only the submitting CR, never the newline or other keys", () => {
    const release = claimEnter("a", () => true);
    expect(railTakesKey("a", new Uint8Array([0x1b, 0x0d]))).toBe(false);
    expect(railTakesKey("a", new TextEncoder().encode("a"))).toBe(false);
    release();
  });

  it("keeps a newer rail when the older one unregisters late", () => {
    const releaseOld = claimEnter("a", () => false);
    const releaseNew = claimEnter("a", () => true);
    releaseOld();
    expect(railTakesKey("a", CR)).toBe(true);
    releaseNew();
  });
});
