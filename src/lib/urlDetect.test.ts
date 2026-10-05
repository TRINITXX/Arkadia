import { describe, expect, it } from "vitest";
import { joinWrappedRows } from "./urlDetect";

describe("joinWrappedRows", () => {
  it("glues a framed row to its neighbours' content, borders dropped", () => {
    const prev = "┃ voir : C:\\Users\\me\\Claude ┃";
    const cur = "┃ Desktop\\shot.png           ┃";
    const j = joinWrappedRows(prev, cur, "┃                           ┃", " ");
    expect(j.text).toBe("voir : C:\\Users\\me\\Claude Desktop\\shot.png");
    // `D` of `Desktop` keeps its place once mapped back to the row.
    const d = [...cur].indexOf("D");
    expect([...j.text][d + j.offset]).toBe("D");
    expect([j.start, j.end]).toEqual([2, 18]);
  });

  it("joins a word cut mid-way without a space", () => {
    const j = joinWrappedRows("  C:\\a\\very-lo", "  ng-name.png", null, "");
    expect(j.text).toBe("C:\\a\\very-long-name.png");
  });

  it("counts code points, not UTF-16 units", () => {
    const j = joinWrappedRows("🎉 C:\\x", "🎉 y.png", null, "");
    expect([...j.text][[..."🎉 y.png"].indexOf("y") + j.offset]).toBe("y");
  });
});
