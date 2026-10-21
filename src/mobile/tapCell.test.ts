import { describe, expect, it } from "vitest";
import { tapCell } from "./tapCell";

const cell = { width: 8, height: 16 };
const frame = { cols: 40, rows: 20 };

describe("tapCell", () => {
  it("finds the cell under the finger", () => {
    expect(tapCell(0, 0, cell, frame)).toEqual({ col: 0, row: 0 });
    expect(tapCell(17, 33, cell, frame)).toEqual({ col: 2, row: 2 });
  });

  it("takes the side padding as the first column", () => {
    expect(tapCell(-3, 5, cell, frame)).toEqual({ col: 0, row: 0 });
  });

  it("ignores a tap past a frame sized for a smaller screen", () => {
    expect(tapCell(1000, 5, cell, frame)).toBeNull();
    expect(tapCell(5, 1000, cell, frame)).toBeNull();
  });
});
