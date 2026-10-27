import { describe, it, expect } from "vitest";
import {
  firstDrawnRow,
  olderStart,
  prependCorrection,
  ROW_WINDOW,
} from "./rowWindow";

describe("firstDrawnRow", () => {
  it("draws only the end of a long conversation at first", () => {
    expect(firstDrawnRow(null, 5130)).toBe(5130 - ROW_WINDOW);
    expect(firstDrawnRow(null, 50)).toBe(0);
  });

  it("keeps its start while rows are appended live", () => {
    expect(firstDrawnRow(4930, 5200)).toBe(4930);
  });

  it("moves back when the list shrinks under it", () => {
    expect(firstDrawnRow(4930, 300)).toBe(300 - ROW_WINDOW);
  });
});

describe("olderStart", () => {
  it("steps back one window, down to the first row", () => {
    expect(olderStart(4930)).toBe(4930 - ROW_WINDOW);
    expect(olderStart(ROW_WINDOW - 10)).toBe(0);
  });
});

describe("prependCorrection", () => {
  it("adds nothing when the browser kept the place", () => {
    expect(prependCorrection(1400, 1400 + 18000, 18000)).toBe(0);
  });

  it("puts the reader back when the offset stayed put", () => {
    expect(prependCorrection(0, 0, 18000)).toBe(18000);
  });

  it("keeps a fling going on during the render", () => {
    expect(prependCorrection(1400, 1300, 18000)).toBe(18000);
  });
});
