import { describe, expect, it } from "vitest";
import { foldStartHeight } from "@/lib/chat/useFoldMotion";

describe("foldStartHeight", () => {
  it("starts the card where the dock was, the input's swap taken out", () => {
    // Folding: the input shows (+105) as the card still holds its body.
    expect(foldStartHeight(241, 535, 430)).toBe(136);
    // Opening: the input hides (-105), the card at its full height.
    expect(foldStartHeight(241, 288, 183)).toBe(136);
    // The panel: no input around it, it starts where it stood.
    expect(foldStartHeight(250, 270, 62)).toBe(42);
    expect(foldStartHeight(250, 270, null)).toBe(250);
    expect(foldStartHeight(40, 400, 100)).toBe(0);
  });
});
