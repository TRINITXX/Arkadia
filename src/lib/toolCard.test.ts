import { describe, expect, it } from "vitest";
import {
  parseToolInput,
  toolStat,
  trimmedDiff,
  trimmedEditDiff,
} from "@/lib/toolCard";

const before = "a\nb\nc\nd\ne\nf";
const after = "a\nb\nc\nD\ne\nf";

describe("trimmedDiff", () => {
  it("keeps only the changed lines and two lines of context around them", () => {
    expect(trimmedDiff(before, after)).toEqual({
      before: ["b", "c"],
      removed: ["d"],
      added: ["D"],
      after: ["e", "f"],
    });
  });
});

describe("trimmedEditDiff", () => {
  // The iPhone's Messages tab draws an edit with the chat's diff rows.
  it("turns the trimmed diff into unnumbered diff rows, counted", () => {
    expect(trimmedEditDiff("x\nold", "x\nnew")).toEqual({
      rows: [
        { kind: "ctx", text: "x" },
        { kind: "del", text: "old" },
        { kind: "add", text: "new" },
      ],
      added: 1,
      removed: 1,
      numbered: false,
    });
  });
});

describe("toolStat", () => {
  it("counts an edit's changed lines, not its whole strings", () => {
    expect(toolStat("Edit", { old_string: before, new_string: after })).toBe(
      "+1 −1",
    );
  });

  it("adds up a MultiEdit's edits and counts a Write's lines", () => {
    expect(
      toolStat("MultiEdit", {
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "c\nd" },
        ],
      }),
    ).toBe("+2 −1");
    expect(toolStat("Write", { content: "1\n2\n3" })).toBe("+3");
  });
});

describe("parseToolInput", () => {
  it("reads an unparsable or scalar input as no parameters", () => {
    expect(parseToolInput("{oops")).toEqual({});
    expect(parseToolInput("42")).toEqual({});
    expect(parseToolInput('{"command":"ls"}')).toEqual({ command: "ls" });
  });
});
