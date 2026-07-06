import { describe, it, expect } from "vitest";
import { stripStatusGlyph, formatNotifLines } from "@/lib/notifLabel";

describe("stripStatusGlyph", () => {
  it("removes a leading ✳ waiting glyph and surrounding whitespace", () => {
    expect(stripStatusGlyph("✳ Arkadia")).toBe("Arkadia");
    expect(stripStatusGlyph("  ✳   Arkadia  ")).toBe("Arkadia");
  });

  it("removes any leading symbol the spinner may use", () => {
    expect(stripStatusGlyph("· Arkadia")).toBe("Arkadia");
    expect(stripStatusGlyph("∙ Arkadia")).toBe("Arkadia");
    expect(stripStatusGlyph("⠙ Arkadia")).toBe("Arkadia");
  });

  it("leaves a plain title untouched", () => {
    expect(stripStatusGlyph("pwsh")).toBe("pwsh");
    expect(stripStatusGlyph("")).toBe("");
  });
});

describe("formatNotifLines", () => {
  it("drops the tab line when the cleaned title matches the project (dedupe)", () => {
    expect(formatNotifLines("Arkadia", "✳ Arkadia", "C:/dev/Arkadia")).toEqual({
      project: "Arkadia",
      tab: null,
    });
    // busy glyph, same dedupe
    expect(formatNotifLines("Arkadia", "⠙ Arkadia", "C:/dev/Arkadia")).toEqual({
      project: "Arkadia",
      tab: null,
    });
  });

  it("dedupes case-insensitively", () => {
    expect(formatNotifLines("arkadia", "✳ Arkadia", "C:/dev/Arkadia")).toEqual({
      project: "arkadia",
      tab: null,
    });
  });

  it("keeps a distinct tab title as the second line", () => {
    expect(
      formatNotifLines("VTC Planner", "✳ Fixing auth bug", "C:/dev/vtc"),
    ).toEqual({ project: "VTC Planner", tab: "Fixing auth bug" });
  });

  it("drops the tab line when the title is empty", () => {
    expect(formatNotifLines("Arkadia", "", "C:/dev/Arkadia")).toEqual({
      project: "Arkadia",
      tab: null,
    });
  });

  it("falls back to the cwd folder name when the project is empty", () => {
    // project empty → folder "my-app"; title cleans to same → deduped
    expect(formatNotifLines("", "✳ my-app", "C:/dev/my-app")).toEqual({
      project: "my-app",
      tab: null,
    });
    // distinct title still shows as line 2 on top of the folder fallback
    expect(formatNotifLines("", "✳ Some task", "C:/dev/my-app")).toEqual({
      project: "my-app",
      tab: "Some task",
    });
    // trailing backslash + windows separators
    expect(formatNotifLines("", "", "C:\\dev\\my-app\\")).toEqual({
      project: "my-app",
      tab: null,
    });
  });
});
