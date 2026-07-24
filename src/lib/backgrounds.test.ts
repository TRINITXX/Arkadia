import { describe, it, expect } from "vitest";
import { DEFAULT_BACKGROUND_ID } from "@/types";
import {
  BACKGROUNDS,
  resolveBackground,
  resolveBackgroundId,
} from "@/lib/backgrounds";

describe("BACKGROUNDS", () => {
  it("has unique ids", () => {
    const ids = BACKGROUNDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts with the default 'noir' preset, which uses no glass", () => {
    expect(BACKGROUNDS[0].id).toBe("noir");
    expect(DEFAULT_BACKGROUND_ID).toBe("noir");
    expect(BACKGROUNDS[0].glass).toBe(false);
  });

  it("marks every non-noir preset as a glass background with a non-empty css", () => {
    for (const bg of BACKGROUNDS) {
      expect(bg.css.length).toBeGreaterThan(0);
      if (bg.id !== "noir") expect(bg.glass).toBe(true);
    }
  });
});

describe("resolveBackgroundId", () => {
  it("keeps a known id", () => {
    expect(resolveBackgroundId("midnight")).toBe("midnight");
    expect(resolveBackgroundId("ocean")).toBe("ocean");
  });

  it("falls back to the default for absent / unknown values", () => {
    expect(resolveBackgroundId(undefined)).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundId(null)).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundId("does-not-exist")).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundId(42)).toBe(DEFAULT_BACKGROUND_ID);
  });
});

describe("resolveBackground", () => {
  it("returns the matching preset", () => {
    expect(resolveBackground("violet").name).toBe("Violet nuit");
  });
});
