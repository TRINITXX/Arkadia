import type { CellRun, RenderPayload } from "@/types";

// `lastIndex`-based regex; the global flag is required to iterate matches with `exec`.
// Excludes whitespace + a few hard-stops; trailing prose punctuation is trimmed
// post-match (see TRAILING_PUNCT) so "see https://example.com." doesn't fail.
const URL_RE = /https?:\/\/[^\s)>"'\]]+/g;
const TRAILING_PUNCT = /[.,;:!?'"]+$/;

export interface UrlMatch {
  kind: "url";
  url: string;
  startCol: number;
  /** Exclusive — the cell at `endCol` is the first one *after* the URL. */
  endCol: number;
  row: number;
}

export interface PathMatch {
  kind: "path";
  /** Absolute path, already resolved (against the pane cwd) by the backend. */
  absPath: string;
  startCol: number;
  endCol: number;
  row: number;
}

export interface HyperlinkMatch {
  kind: "hyperlink";
  url: string;
  startCol: number;
  endCol: number;
  row: number;
}

export type ClickableMatch = UrlMatch | PathMatch | HyperlinkMatch;

/**
 * Builds the row's plaintext alongside a parallel mapping from char-index
 * (in the concatenated string) → cell column, plus the width-per-cell of
 * each char. Continuation cells are skipped by the backend so each char
 * here corresponds to one rendered grapheme.
 */
export function buildRowMapping(line: CellRun[]): {
  text: string;
  charToCol: number[];
  charWidth: number[];
} {
  let text = "";
  const charToCol: number[] = [];
  const charWidth: number[] = [];
  let col = 0;
  for (const run of line) {
    const cellWidth = run.cell_width ?? 1;
    const chars = [...run.text];
    for (const c of chars) {
      text += c;
      charToCol.push(col);
      charWidth.push(cellWidth);
      col += cellWidth;
    }
  }
  return { text, charToCol, charWidth };
}

/** Cell column → char index in the row's plaintext, or null if outside any cell. */
export function colToCharIndex(
  charToCol: number[],
  charWidth: number[],
  col: number,
): number | null {
  for (let i = 0; i < charToCol.length; i++) {
    if (col >= charToCol[i] && col < charToCol[i] + charWidth[i]) return i;
  }
  return null;
}

/** Char range [start, end) in the plaintext → cell columns (endCol exclusive). */
export function charRangeToCols(
  charToCol: number[],
  charWidth: number[],
  start: number,
  end: number,
): { startCol: number; endCol: number } | null {
  if (start < 0 || end <= start || end > charToCol.length) return null;
  return {
    startCol: charToCol[start],
    endCol: charToCol[end - 1] + charWidth[end - 1],
  };
}

/**
 * Returns the URL covering the cell at `(col, row)` in the rendered screen,
 * or `null`. Wide-char aware: regex matches on the concatenated text and
 * char-indices are mapped back to cell columns.
 */
export function findUrlAt(
  screen: RenderPayload,
  col: number,
  row: number,
): UrlMatch | null {
  const line = screen.lines[row];
  if (!line) return null;
  const { text, charToCol, charWidth } = buildRowMapping(line);
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text)) !== null) {
    const cleaned = match[0].replace(TRAILING_PUNCT, "");
    if (cleaned.length === 0) continue;
    const startCharIdx = match.index;
    const lastCharIdx = startCharIdx + cleaned.length - 1;
    if (lastCharIdx >= charToCol.length) continue;
    const startCol = charToCol[startCharIdx];
    const endCol = charToCol[lastCharIdx] + charWidth[lastCharIdx];
    if (col >= startCol && col < endCol) {
      return { kind: "url", url: cleaned, startCol, endCol, row };
    }
  }
  return null;
}

/**
 * OSC 8 hyperlink: the backend tags individual cells with `hyperlink`. We walk
 * the runs and find the contiguous span of cells sharing the same URL. Wide
 * chars push their link onto each cell column they occupy.
 */
export function findHyperlinkAt(
  screen: RenderPayload,
  col: number,
  row: number,
): HyperlinkMatch | null {
  const line = screen.lines[row];
  if (!line) return null;
  const cellLinks: Array<string | undefined> = [];
  for (const run of line) {
    const link = run.hyperlink;
    const cellWidth = run.cell_width ?? 1;
    const cells = [...run.text].length * cellWidth;
    for (let i = 0; i < cells; i++) cellLinks.push(link);
  }
  const target = cellLinks[col];
  if (!target) return null;
  let startCol = col;
  while (startCol > 0 && cellLinks[startCol - 1] === target) startCol--;
  let endCol = col + 1;
  while (endCol < cellLinks.length && cellLinks[endCol] === target) endCol++;
  return { kind: "hyperlink", url: target, startCol, endCol, row };
}

/**
 * Synchronous click detection: OSC 8 hyperlinks win, then URL regex. File paths
 * are resolved separately and asynchronously by the backend `resolve_path_at`
 * command — they need filesystem validation to handle spaces, so they are not
 * matched here.
 */
export function findClickableAt(
  screen: RenderPayload,
  col: number,
  row: number,
): UrlMatch | HyperlinkMatch | null {
  return findHyperlinkAt(screen, col, row) ?? findUrlAt(screen, col, row);
}

// Re-export to ease unit testing.
export type { CellRun };
