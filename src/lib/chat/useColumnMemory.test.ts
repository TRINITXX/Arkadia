import { describe, expect, it } from "vitest";
import { measureColumn } from "@/lib/chat/useColumnMemory";

const rect = (top: number, bottom: number) => ({
  getBoundingClientRect: () => ({ top, bottom }),
});
const scroller = (height: number) =>
  ({
    clientHeight: height,
    clientWidth: height ? 800 : 0,
    ...rect(100, 100 + height),
  }) as unknown as HTMLElement;
const inner = {
  children: [rect(-300, -100), rect(-90, 40), rect(50, 200), rect(210, 500)],
} as unknown as HTMLElement;

describe("the chat column's place", () => {
  it("is the first row ending below the top, and its height", () => {
    expect(measureColumn(scroller(600), inner, false)).toEqual({
      index: 2,
      offset: -50,
      stuck: false,
    });
    expect(measureColumn(scroller(600), inner, true)?.stuck).toBe(true);
  });

  it("is never read from a hidden tab's column (no layout)", () => {
    expect(measureColumn(scroller(0), inner, false)).toBeNull();
  });
});
