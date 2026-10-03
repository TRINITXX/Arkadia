import type { CellRun, RenderPayload } from "@/types";

/** Display width of a row once trailing blanks are dropped. */
function contentWidth(runs: CellRun[]): number {
  let width = 0;
  let col = 0;
  for (const r of runs) {
    const w = r.cell_width ?? 1;
    for (const ch of [...r.text]) {
      col += w;
      if (ch.trim().length > 0) width = col;
    }
  }
  return width;
}

/**
 * True when the pane shows nothing but an idle shell prompt: no scrollback, a
 * single non-blank row holding the cursor, ending with the PowerShell `>` and
 * nothing typed after it. Lets a toolbar action reuse a tab that was just
 * opened instead of spawning another one. A prompt long enough to wrap, or any
 * earlier output, fails the check — the caller then falls back to a new tab.
 */
export function isBlankShell(screen: RenderPayload | null): boolean {
  if (!screen || screen.scroll_max > 0) return false;
  let promptRow = -1;
  for (let r = 0; r < screen.rows; r++) {
    if (contentWidth(screen.lines[r] ?? []) === 0) continue;
    if (promptRow !== -1) return false;
    promptRow = r;
  }
  if (promptRow === -1 || promptRow !== screen.cursor_row) return false;
  const runs = screen.lines[promptRow] ?? [];
  const text = runs
    .map((r) => r.text)
    .join("")
    .trimEnd();
  return text.endsWith(">") && contentWidth(runs) <= screen.cursor_col;
}
