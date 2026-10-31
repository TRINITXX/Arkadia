import { describe, expect, it } from "vitest";
import { editDiff, hunkRows } from "@/lib/chat/chatDiff";

describe("editDiff", () => {
  it("numbers the real diff's lines, context included, and folds the gap between hunks", () => {
    const rows = hunkRows([
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [" un", "-deux", "+DEUX", " trois"],
      },
      {
        oldStart: 10,
        oldLines: 1,
        newStart: 10,
        newLines: 2,
        lines: [" dix", "+onze", "\\ No newline at end of file"],
      },
    ]);
    expect(rows).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "un" },
      { kind: "del", old: 2, text: "deux" },
      { kind: "add", new: 2, text: "DEUX" },
      { kind: "ctx", old: 3, new: 3, text: "trois" },
      { kind: "gap", lines: 6 },
      { kind: "ctx", old: 10, new: 10, text: "dix" },
      { kind: "add", new: 11, text: "onze" },
    ]);
  });

  it("shows a Write over an existing file as its real diff, not all green", () => {
    // Claude Code's result for b.txt rewritten (live run of 31/10/2026).
    const diff = editDiff(
      "Write",
      { file_path: "b.txt", content: "alpha\nBETA\ngamma\ndelta\n" },
      {
        write: "update",
        hunks: [
          {
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 4,
            lines: [" alpha", "-beta", "+BETA", " gamma", "+delta"],
          },
        ],
      },
    );
    expect(diff.numbered).toBe(true);
    expect([diff.added, diff.removed]).toEqual([2, 1]);
    expect(diff.rows.filter((r) => r.kind === "ctx")).toHaveLength(2);
  });

  it("numbers a new file from 1, and keeps an input's lines unnumbered without a result", () => {
    const created = editDiff(
      "Write",
      { content: "a\nb\n" },
      { write: "create", hunks: [] },
    );
    expect(created.rows).toEqual([
      { kind: "add", new: 1, text: "a" },
      { kind: "add", new: 2, text: "b" },
    ]);
    const fromInput = editDiff(
      "Edit",
      { old_string: "x", new_string: "y" },
      undefined,
    );
    expect(fromInput.numbered).toBe(false);
    expect(fromInput.rows).toEqual([
      { kind: "del", text: "x" },
      { kind: "add", text: "y" },
    ]);
  });
});
