import { describe, expect, it } from "vitest";
import type { ConvBlock } from "@/lib/convStore";
import {
  blockShown,
  DEFAULT_CONV_FILTERS,
  filtersHideAny,
  type ConvFilters,
} from "@/lib/convFilters";

const KINDS: ConvBlock["kind"][] = ["user", "assistant", "thinking", "tool"];

describe("blockShown", () => {
  // The reading view's default, on the desktop, the web page and the iPhone.
  it("shows only the user's messages and Claude's by default", () => {
    expect(KINDS.filter((k) => blockShown(k, DEFAULT_CONV_FILTERS))).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("lets the thinking and tools filters show their own kind alone", () => {
    const none: ConvFilters = {
      user: false,
      assistant: false,
      thinking: false,
      tools: false,
      results: false,
    };
    const shownWith = (key: keyof ConvFilters) =>
      KINDS.filter((k) => blockShown(k, { ...none, [key]: true }));
    expect(shownWith("thinking")).toEqual(["thinking"]);
    expect(shownWith("tools")).toEqual(["tool"]);
  });
});

describe("filtersHideAny", () => {
  it("is off only when every type shows, results included", () => {
    expect(filtersHideAny(DEFAULT_CONV_FILTERS)).toBe(true);
    expect(
      filtersHideAny({
        user: true,
        assistant: true,
        thinking: true,
        tools: true,
        results: true,
      }),
    ).toBe(false);
  });
});
