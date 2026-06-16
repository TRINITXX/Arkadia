import type { CellRun } from "@/types";

/** Column of the first non-space cell of a row, or null when the row is blank. */
export function firstContentCol(runs: CellRun[]): number | null {
  let col = 0;
  for (const r of runs) {
    const w = r.cell_width ?? 1;
    for (const ch of [...r.text]) {
      if (ch.trim().length > 0) return col;
      col += w;
    }
  }
  return null;
}

/**
 * Claude Code's chrome around the conversation: the "Jump to bottom" pill, the
 * right-aligned token counter, the ccstatusline status row, the permission/hint
 * row, and the spinner ("✶ Sautéed for 7s" / "(esc to interrupt)"). Heuristic
 * (keyword/alignment based). Message text and the `❯` input line never match —
 * so the popup can drop these, and the terminal can tell where the transcript
 * ends. Note: the input box is NOT chrome here (see `isInputRow`).
 */
export function isChromeRow(runs: CellRun[], cols: number): boolean {
  const idx = firstContentCol(runs);
  if (idx === null) return false; // blank
  // A numbered selector option is real, selectable content — never chrome — even
  // when its text happens to contain a status-line keyword (ExitPlanMode's first
  // option is literally "1. Yes, and bypass permissions").
  if (isOptionRow(runs)) return false;
  const t = runs.map((r) => r.text).join("");
  if (isJumpPill(runs)) return true;
  if (idx * 4 >= cols * 3 && /\btokens?\b/i.test(t)) return true;
  if (/Ctx\(|Session:\s*\d|Weekly:\s*\d|Reset:\s*\d/.test(t)) return true;
  if (
    /bypass permissions|shift\+tab to cycle|accept edits|plan mode on|for agents|⏵⏵/.test(
      t,
    )
  )
    return true;
  if (/\besc to interrupt\b/i.test(t)) return true;
  // Spinner: "✶ Churned for 8m 8s" / "✶ Sautéed for 7s" — the duration may carry
  // hours/minutes/seconds, so accept any run of `<num><h|m|s>` after "for".
  if (/^[^\p{L}\p{N}\s]+\s+\p{L}+\s+for\s+(?:\d+[hms]\s*)+$/u.test(t))
    return true;
  return false;
}

/**
 * The floating "Jump to bottom (ctrl+End)" pill — only the real overlay, not a
 * message that merely mentions the phrase. The overlay is styled (a coloured
 * background and/or the ctrl+End hint); plain prose mentioning it is on the
 * default background without the keybind.
 */
export function isJumpPill(runs: CellRun[]): boolean {
  const text = runs.map((r) => r.text).join("");
  if (!text.includes("Jump to bottom")) return false;
  return (
    text.includes("ctrl+End") ||
    runs.some((r) => r.bg.kind !== "default" && r.text.trim().length > 0)
  );
}

/** Row text with a leading box border (`│`/`┃`) and surrounding space stripped,
 * so prompt/option detection works whether or not the prompt is drawn inside a
 * bordered box (ExitPlanMode wraps its plan/options in one). */
function unframed(runs: CellRun[]): string {
  return runs
    .map((r) => r.text)
    .join("")
    .trimStart()
    .replace(/^[│┃]\s*/, "");
}

/** The live input prompt row — a `❯` at the start of the line (after any box
 * border). Also the selected option of a `❯`-cursor selector. */
export function isInputRow(runs: CellRun[]): boolean {
  return unframed(runs).startsWith("❯");
}

/**
 * A numbered selector option row — `❯ 1. …` (selected) or `  2. …` — as drawn by
 * AskUserQuestion and ExitPlanMode. Lets the popup footer anchor on the choices
 * even when the prompt has no `❯` text-input row (ExitPlanMode's "Yes / No"
 * approval box).
 */
export function isOptionRow(runs: CellRun[]): boolean {
  return /^[❯>]?\s*\d+\.\s/.test(unframed(runs));
}

/**
 * A drawn-box row: a side/corner of a box-drawing frame (`│ ╭ ╮ ╰ ╯ ├ ┤`).
 * ExitPlanMode renders the plan itself inside such a box, *above* its approval
 * question — so when the popup footer walks up from the options it can stop here
 * and leave the (already-shown-in-the-reading-view) plan out of the field.
 */
export function isBoxRow(runs: CellRun[]): boolean {
  const t = runs
    .map((r) => r.text)
    .join("")
    .trim();
  return /^[│┃╭╮╰╯├┤┌┐└┘]/.test(t) || /[╭╮╰╯┌┐└┘]/.test(t);
}
