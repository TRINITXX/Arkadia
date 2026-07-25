import { describe, expect, it } from "vitest";
import { inputRowIndex } from "@/lib/terminalChrome";
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

function screenOf(rows: string[]): RenderPayload {
  return {
    session_id: "p1",
    cols: 80,
    rows: rows.length,
    cursor_row: 0,
    cursor_col: 0,
    cursor_visible: true,
    title: "",
    lines: rows.map((t) => [run(t)]),
    scroll_offset: 0,
    scroll_max: 0,
    mouse_protocol: 0,
    mouse_sgr: false,
    bracketed_paste: false,
  };
}

describe("inputRowIndex", () => {
  it("finds the row of Claude Code's input box", () => {
    expect(
      inputRowIndex(
        screenOf([
          "● done",
          "╭──────────────╮",
          "❯ /rc",
          "╰──────────────╯",
          "  ⏵⏵ accept edits on",
        ]),
      ),
    ).toBe(2);
  });

  it("takes the bottom-most one, so a quoted `❯` in the transcript never wins", () => {
    expect(inputRowIndex(screenOf(["❯ my previous message", "", "❯ "]))).toBe(
      2,
    );
  });

  it("reports -1 with no prompt on screen (plain shell) and no frame at all", () => {
    expect(inputRowIndex(screenOf(["PS C:\\> ", "hello"]))).toBe(-1);
    expect(inputRowIndex(null)).toBe(-1);
  });
});
