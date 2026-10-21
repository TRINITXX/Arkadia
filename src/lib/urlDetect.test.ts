import { describe, expect, it } from "vitest";
import { joinWrappedRows, wrappedRowJoins } from "./urlDetect";

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

describe("wrappedRowJoins", () => {
  it("finds a path cut between prose above and another path below", () => {
    const rows = [
      "  Captures pendant l'essai :",
      "  C:\\Users\\me\\Mobile\\.screenshots\\",
      "  android-essai-haut_v1.png",
      "  C:\\Users\\me\\Mobile\\.screenshots\\",
      "  android-essai-bas_v1.png",
    ];
    const path =
      "C:\\Users\\me\\Mobile\\.screenshots\\android-essai-haut_v1.png";
    // From either half, one probe holds the whole path, a space (or the
    // text's edge) bounding it from the rows that are not part of it.
    const holdsPath = (r: number) =>
      wrappedRowJoins(rows[r - 1], rows[r], rows[r + 1]).some((j) =>
        ` ${j.text} `.includes(` ${path} `),
      );
    expect(holdsPath(1)).toBe(true);
    expect(holdsPath(2)).toBe(true);
  });

  it("joins a middle row whose two breaks differ", () => {
    const j = wrappedRowJoins(
      "  C:\\Users\\me\\Claude",
      "  Desktop\\.screenshots\\logo-des-marq",
      "  ues_v1.png",
    ).map((x) => x.text);
    expect(j).toContain(
      "C:\\Users\\me\\Claude Desktop\\.screenshots\\logo-des-marques_v1.png",
    );
  });

  it("probes nothing when no row holds a path separator", () => {
    expect(wrappedRowJoins("Captures :", "pendant l'essai", null)).toEqual([]);
  });
});
