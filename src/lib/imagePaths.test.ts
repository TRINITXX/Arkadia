import { describe, expect, it } from "vitest";
import { findImagePaths, isImagePath } from "./imagePaths";

describe("isImagePath", () => {
  it("accepts absolute Windows image paths", () => {
    expect(isImagePath("C:\\shots\\screen.png")).toBe(true);
    expect(isImagePath("D:/img/photo.JPEG")).toBe(true);
  });

  it("rejects relative paths and non-images", () => {
    expect(isImagePath("shots/screen.png")).toBe(false);
    expect(isImagePath("C:\\code\\main.rs")).toBe(false);
    expect(isImagePath("C:\\x\\tool.exe")).toBe(false);
  });
});

describe("findImagePaths", () => {
  it("finds paths with both slash styles", () => {
    const text = "saved to C:\\a\\b\\shot.png and also D:/x/y.webp done";
    expect(findImagePaths(text)).toEqual(["C:\\a\\b\\shot.png", "D:/x/y.webp"]);
  });

  it("does not swallow a :line suffix", () => {
    // ':' is excluded from path segments, so the match stops at the extension.
    expect(findImagePaths("see C:\\a\\shot.png:12:3 here")).toEqual([
      "C:\\a\\shot.png",
    ]);
  });

  it("ignores relative mentions and non-image files", () => {
    expect(findImagePaths("look at shot.png or C:\\a\\code.ts")).toEqual([]);
  });

  it("excludes paths with spaces (pragmatic v1)", () => {
    expect(findImagePaths("C:\\My Files\\shot.png")).toEqual([]);
  });

  it("dedupes case-insensitively and caps results", () => {
    const p = "C:\\a\\s.png";
    const many = Array.from({ length: 8 }, (_, i) => `C:\\a\\s${i}.png`).join(
      " ",
    );
    expect(findImagePaths(`${p} ${p.toUpperCase()}`)).toEqual([p]);
    expect(findImagePaths(many)).toHaveLength(4);
  });
});
