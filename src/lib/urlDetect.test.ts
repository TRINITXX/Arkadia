import { describe, expect, it } from "vitest";
import { joinWrappedRows } from "./urlDetect";

/** The joined char that `row`'s char `i` maps to. */
const at = (j: ReturnType<typeof joinWrappedRows>, delta: number, i: number) =>
  [...j.text][i + j.rows.find((r) => r.delta === delta)!.offset];

describe("joinWrappedRows", () => {
  it("glues a framed row to its neighbours' content, borders dropped", () => {
    const prev = "┃ voir : C:\\Users\\me\\Claude ┃";
    const cur = "┃ Desktop\\shot.png           ┃";
    const j = joinWrappedRows(prev, cur, "┃                           ┃", " ");
    expect(j.text).toBe("voir : C:\\Users\\me\\Claude Desktop\\shot.png");
    // Blank neighbours bring nothing; each row maps back to its own chars.
    expect(j.rows.map((r) => [r.delta, r.start, r.end])).toEqual([
      [-1, 2, 27],
      [0, 2, 18],
    ]);
    expect(at(j, 0, [...cur].indexOf("D"))).toBe("D");
    expect(at(j, -1, [...prev].indexOf("C"))).toBe("C");
  });

  it("joins a word cut mid-way without a space", () => {
    const j = joinWrappedRows("  C:\\a\\very-lo", "  ng-name.png", null, "");
    expect(j.text).toBe("C:\\a\\very-long-name.png");
  });

  it("counts code points, not UTF-16 units", () => {
    const j = joinWrappedRows("🎉 C:\\x", "🎉 y.png", null, "");
    expect(at(j, 0, [..."🎉 y.png"].indexOf("y"))).toBe("y");
  });
});
