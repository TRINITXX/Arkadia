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

  it("keeps paths with spaces, stopping at the extension", () => {
    expect(
      findImagePaths(
        "capture : C:\\Users\\me\\Claude Desktop\\.screenshots\\vue 1.png puis la suite",
      ),
    ).toEqual(["C:\\Users\\me\\Claude Desktop\\.screenshots\\vue 1.png"]);
  });

  it("never merges two paths on one line", () => {
    expect(findImagePaths("C:\\a\\notes.md et D:\\b c\\shot.jpg")).toEqual([
      "D:\\b c\\shot.jpg",
    ]);
  });

  it("stops at markdown backticks", () => {
    expect(findImagePaths("`C:\\a b\\x.png` et `C:\\c\\y.gif`")).toEqual([
      "C:\\a b\\x.png",
      "C:\\c\\y.gif",
    ]);
  });

  it("resolves relative paths against the base dir, in text order", () => {
    const base = "C:\\Users\\me\\VTC-Planner-Mobile";
    expect(
      findImagePaths(
        "voir `.screenshots/a.png`, C:\\x\\b.png et docs\\img\\c.jpg",
        12,
        base,
      ),
    ).toEqual([
      `${base}\\.screenshots\\a.png`,
      "C:\\x\\b.png",
      `${base}\\docs\\img\\c.jpg`,
    ]);
  });

  it("counts a relative path and its absolute spelling once", () => {
    const base = "C:\\p";
    expect(
      findImagePaths(
        ".screenshots/a.png — C:\\p\\.screenshots\\a.png",
        12,
        base,
      ),
    ).toEqual(["C:\\p\\.screenshots\\a.png"]);
  });

  it("ignores relative paths without a base dir, bare names and URLs", () => {
    expect(findImagePaths(".screenshots/a.png")).toEqual([]);
    expect(
      findImagePaths("shot.png, https://x.io/y/z.png, lot4-*.png", 12, "C:\\p"),
    ).toEqual([]);
  });

  it("dedupes case-insensitively and caps results", () => {
    const p = "C:\\a\\s.png";
    const many = Array.from({ length: 20 }, (_, i) => `C:\\a\\s${i}.png`).join(
      " ",
    );
    expect(findImagePaths(`${p} ${p.toUpperCase()}`)).toEqual([p]);
    expect(findImagePaths(many)).toHaveLength(12);
  });
});
