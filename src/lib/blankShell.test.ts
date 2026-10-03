import { describe, expect, it } from "vitest";
import { isBlankShell } from "@/lib/blankShell";
import type { CellRun, RenderPayload } from "@/types";

function run(text: string): CellRun {
  return {
    text,
    fg: { kind: "default" },
    bg: { kind: "default" },
    bold: false,
    italic: false,
    underline_style: 0,
    inverse: false,
  };
}

const PROMPT = "PS C:\\Users\\me\\project> ";

function screenOf(
  rows: string[],
  cursor: { row: number; col: number },
  scrollMax = 0,
): RenderPayload {
  return {
    session_id: "p1",
    cols: 80,
    rows: rows.length,
    cursor_row: cursor.row,
    cursor_col: cursor.col,
    cursor_visible: true,
    title: "",
    lines: rows.map((t) => [run(t)]),
    scroll_offset: 0,
    scroll_max: scrollMax,
    mouse_protocol: 0,
    mouse_sgr: false,
    bracketed_paste: false,
  };
}

describe("isBlankShell", () => {
  it("accepts a fresh tab showing only the prompt", () => {
    expect(
      isBlankShell(screenOf([PROMPT, "", ""], { row: 0, col: PROMPT.length })),
    ).toBe(true);
  });

  it("rejects a prompt with text typed after it", () => {
    const line = `${PROMPT}npm run`;
    expect(
      isBlankShell(screenOf([line, ""], { row: 0, col: line.length })),
    ).toBe(false);
  });

  it("rejects a tab that already ran something", () => {
    expect(
      isBlankShell(
        screenOf([`${PROMPT}echo hi`, "hi", PROMPT], {
          row: 2,
          col: PROMPT.length,
        }),
      ),
    ).toBe(false);
    expect(
      isBlankShell(screenOf([PROMPT, ""], { row: 0, col: PROMPT.length }, 12)),
    ).toBe(false);
  });

  it("rejects a shell still booting and a missing frame", () => {
    expect(isBlankShell(screenOf(["", ""], { row: 0, col: 0 }))).toBe(false);
    expect(isBlankShell(null)).toBe(false);
  });
});
