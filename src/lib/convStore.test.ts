import { describe, expect, it } from "vitest";
import type { ConvBlock } from "@/components/ModernConversationView";
import {
  applyDelta,
  dropHeldConv,
  EMPTY_CONV,
  getHeldConv,
  setHeldConv,
  type HeldConv,
} from "./convStore";

const block = (text: string): ConvBlock => ({ kind: "assistant", text });

const held: HeldConv = {
  generation: 3,
  blocks: [block("a"), block("b"), block("c")],
  sessionId: "s1",
  cwd: "C:/p",
};

describe("applyDelta", () => {
  it("keeps the first `base` blocks and replaces the rest", () => {
    const next = applyDelta(held, {
      generation: 3,
      base: 2,
      blocks: [block("c2"), block("d")],
      sessionId: "s1",
      cwd: "C:/p",
    });
    expect(next.blocks.map((b) => b.text)).toEqual(["a", "b", "c2", "d"]);
  });

  it("starts over from a base of 0 (rebuilt transcript)", () => {
    const next = applyDelta(held, {
      generation: 4,
      base: 0,
      blocks: [block("x")],
    });
    expect(next).toEqual({
      generation: 4,
      blocks: [block("x")],
      sessionId: null,
      cwd: null,
    });
  });
});

describe("held conversations", () => {
  it("outlive the view until the pane is dropped", () => {
    setHeldConv("p", held);
    expect(getHeldConv("p")).toBe(held);
    dropHeldConv("p");
    expect(getHeldConv("p")).toBeUndefined();
    setHeldConv("p", EMPTY_CONV);
    expect(getHeldConv("p")).toBe(EMPTY_CONV);
    dropHeldConv("p");
  });
});
