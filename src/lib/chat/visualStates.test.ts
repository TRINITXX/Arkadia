import { describe, expect, it } from "vitest";
import {
  keepVisualState,
  onVisualState,
  visualState,
} from "@/lib/chat/visualStates";

describe("a choice visual's state", () => {
  it("is kept by its call, heard by its other frame, the oldest dropped past 40", () => {
    const heard: unknown[] = [];
    const off = onVisualState("toolu_1", (state, from) =>
      heard.push([state, from]),
    );
    keepVisualState("toolu_1", [{ cur: 1 }], "card");
    expect(visualState("toolu_1")).toEqual([{ cur: 1 }]);
    expect(heard).toEqual([[[{ cur: 1 }], "card"]]);
    off();
    for (let i = 0; i < 40; i++) keepVisualState(`other${i}`, [], null);
    expect(visualState("toolu_1")).toBeNull();
    expect(heard).toHaveLength(1);
  });
});
