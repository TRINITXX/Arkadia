import type { CellRun, RenderPayload } from "@/types";

/**
 * Row index of Claude Code's live `❯` input line (the bottom-most one), or -1
 * when the screen has none — e.g. a plain shell, or an option selector that
 * replaced the field. Lets an overlay align itself with the input box.
 */
export function inputRowIndex(screen: RenderPayload | null): number {
  if (!screen) return -1;
  for (let r = screen.rows - 1; r >= 0; r--) {
    if (isInputRow(screen.lines[r] ?? [])) return r;
  }
  return -1;
}

/**
 * Whether that `❯` row is Claude Code's text field — drawn right under the
 * input box's top border. An earlier message quoted in the transcript (Ctrl+O)
 * or a selector's highlighted choice starts with `❯` too, and editing keys
 * mean something else there (Ctrl+E toggles show-all, Ctrl+U scrolls).
 */
export function isPromptField(screen: RenderPayload | null): boolean {
  const r = inputRowIndex(screen);
  if (!screen || r < 1) return false;
  if (isOptionRow(screen.lines[r] ?? [])) return false;
  const above = (screen.lines[r - 1] ?? [])
    .map((run) => run.text)
    .join("")
    .trim();
  return above.startsWith("─") || above.startsWith("╭");
}

/** The example an empty field shows, dim (`Try "fix typecheck errors"`). */
const FIELD_EXAMPLE = /^Try ".*"$/;

/**
 * What Claude Code's prompt field holds, or null when the screen shows no
 * field. A long text wraps onto rows indented under the `❯`, down to the
 * box's bottom border: the rows are joined. Dim text is no text by default:
 * the empty field's example, a suggestion. With `dim`, it counts: the words
 * of a dictation under way are dim until final (Claude Code's voice docs),
 * though the example still doesn't. The recording's cursor bar (block
 * glyphs) goes.
 */
export function promptFieldText(
  screen: RenderPayload | null,
  { dim = false }: { dim?: boolean } = {},
): string | null {
  if (!screen || !isPromptField(screen)) return null;
  const top = inputRowIndex(screen);
  const rows: string[] = [];
  for (let r = top; r < screen.rows; r++) {
    const runs = screen.lines[r] ?? [];
    const raw = runs.map((run) => run.text).join("");
    if (r > top && /^\s*[─╰└]/.test(raw)) break;
    rows.push(
      runs
        .filter((run) => dim || !run.dim)
        .map((run) => run.text)
        .join(""),
    );
  }
  const text = rows
    .map((row, i) =>
      (i === 0 ? row.replace(/^\s*[│┃]?\s*❯/, "") : row)
        .replace(/^\s*[│┃]/, "")
        .replace(/[│┃]\s*$/, ""),
    )
    .join(" ")
    .replace(/[▀-▟]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return FIELD_EXAMPLE.test(text) ? "" : text;
}

/**
 * What Claude Code's voice mode prints (v2.1.310), alone on its row, while
 * warming up, recording and transcribing.
 */
const VOICE_STATUS = /^(?:keep holding|listening|Voice: processing)…$/;

/**
 * Whether a dictation is still under way — recording or being transcribed —
 * i.e. its text isn't in the prompt yet. Claude Code prints its voice status
 * right-aligned on the row above the input box, where the effort badge sits
 * otherwise (seen through a PTY on v2.1.310). Matching the whole row keeps out
 * a transcript line that merely quotes those words.
 */
export function isDictating(screen: RenderPayload | null): boolean {
  return VOICE_STATUS.test(voiceStatusRow(screen));
}

/** The text of the row where Claude Code prints its voice status. */
function voiceStatusRow(screen: RenderPayload | null): string {
  const r = inputRowIndex(screen);
  if (!screen || r < 2) return "";
  return (screen.lines[r - 2] ?? [])
    .map((run) => run.text)
    .join("")
    .trim();
}

/**
 * How Claude Code reports, in the same spot, a dictation that brought no text
 * (wording from its voice dictation docs, v2.1.314).
 */
const VOICE_FAILURE =
  /^(?:No speech detected|No audio detected|Voice connection failed|Voice stream error|Dictation error)/;

/** Claude Code's notice of a dictation that brought no text, or null. */
export function voiceFailure(screen: RenderPayload | null): string | null {
  const status = voiceStatusRow(screen);
  return VOICE_FAILURE.test(status) ? status : null;
}

/** The known failures (`VOICE_FAILURE`) in French. */
const VOICE_FAILURES_FR: [RegExp, string][] = [
  [/^No speech detected/, "Aucune parole détectée"],
  [/^No audio detected/, "Aucun son reçu du micro"],
  [/^Voice connection failed/, "Connexion au service vocal impossible"],
  [/^Voice stream error/, "Erreur du flux vocal"],
  [/^Dictation error/, "Erreur de dictée"],
];

/**
 * A dictation's failure as the toast says it: in French, with Claude Code's
 * own detail after a colon (« Dictation error: … »); an unknown one as is.
 */
export function voiceFailureText(failure: string): string {
  for (const [known, fr] of VOICE_FAILURES_FR) {
    const match = known.exec(failure);
    if (!match) continue;
    const detail = /^\s*:\s*(.+)$/.exec(failure.slice(match[0].length))?.[1];
    return detail ? `${fr} : ${detail.replace(/\.$/, "")}` : fr;
  }
  return `Claude Code : ${failure}`;
}

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

/**
 * The key that answers Claude Code's folder-trust question with yes, or null
 * when the question isn't on screen. Since v2.1.314 its options carry no
 * number and the cursor starts on "No, exit": Enter there quits, so the
 * cursor goes down to the yes first. The cursor is the bottom-most `❯` row,
 * under the question: the same words in the prompt field are no question.
 */
export function trustAnswerKey(lines: CellRun[][]): "enter" | "down" | null {
  const asked = lines.findIndex((runs) =>
    /trust this folder|one you trust|trust the files/i.test(unframed(runs)),
  );
  if (asked < 0) return null;
  for (let r = lines.length - 1; r > asked; r--) {
    if (!isInputRow(lines[r])) continue;
    const choice = unframed(lines[r]).replace(/^❯\s*(?:\d+\.\s*)?/, "");
    return /^yes\b/i.test(choice) ? "enter" : "down";
  }
  return null;
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
 * AskUserQuestion with MORE THAN ONE question draws a tab/progress bar above the
 * options: `←  ☐ Header1  ☐ Header2  ✔ Submit  →`. Each question is a `☐` chip
 * that flips to `☒` once answered; the trailing `✔ Submit` chip is the final step
 * that actually submits the whole tool call. A single-question prompt has only a
 * lone `☐ Header` chip — no arrows, no `Submit`.
 *
 * Returns `null` when no such bar is on screen (single question / not a question),
 * or `{ atSubmit }` where `atSubmit` is true once every question is answered (no
 * `☐` left) — i.e. the active step is `Submit`, where Enter resolves the prompt.
 * The popup uses this so plain Enter advances between questions (keep the popup
 * open) and only closes it on the final Submit. Verified against real captures.
 */
export function askQuestionTabBar(
  lines: CellRun[][],
): { atSubmit: boolean } | null {
  for (const runs of lines) {
    const t = runs.map((r) => r.text).join("");
    if (t.includes("←") && t.includes("→") && t.includes("Submit")) {
      return { atSubmit: !t.includes("☐") };
    }
  }
  return null;
}

/** Smallest footer we'll ever reserve (a bare prompt with no box). */
const MIN_FOOTER_ROWS = 3;

/**
 * The live "working" indicator Claude Code prints just above the input while it's
 * busy: the spinner line ("✶ Skedaddling… (6m 25s · ↑ 18.0k tokens)" / "esc to
 * interrupt") and the todo / sub-step bullets underneath it. Detected so the
 * modern view's footer grows to surface live activity, then shrinks when idle.
 */
export function isActivityRow(runs: CellRun[]): boolean {
  const t = runs.map((r) => r.text).join("");
  if (/\besc to interrupt\b/i.test(t)) return true;
  if (/↑\s*[\d.]+\s*k?\s*tokens/i.test(t)) return true;
  if (/\(\s*\d+m\s*\d+s\b/.test(t) || /\(\s*\d+s\b/.test(t)) return true;
  return /^[◻◼☐☑✓✔⎿⏺↳]\s/u.test(unframed(runs));
}

/**
 * Number of rows — counted from the bottom — that make up Claude Code's input
 * footer: the input box (`❯`) plus everything below it (statusline, mode/hint
 * row), and any interactive prompt box that replaces the input (ExitPlanMode /
 * AskUserQuestion option selectors). The modern view overlays everything *above*
 * this so the real terminal's input region stays visible and usable beneath it.
 *
 * Strategy: find the bottom-most input/option row, extend up through the box
 * border (and a blank line) that wraps it, then take everything from there down.
 * Capped at 60% of the pane so a long ExitPlanMode plan can't swallow the view.
 */
export function footerRowCount(screen: RenderPayload | null): number {
  if (!screen) return MIN_FOOTER_ROWS;
  const { lines, cols, rows } = screen;
  if (rows <= 0) return MIN_FOOTER_ROWS;

  let inputIdx = -1;
  for (let r = rows - 1; r >= 0; r--) {
    const runs = lines[r] ?? [];
    if (isInputRow(runs) || isOptionRow(runs)) {
      inputIdx = r;
      break;
    }
  }
  if (inputIdx < 0) {
    // No Claude Code prompt found — keep just enough for a chrome/statusline strip.
    let chromeTop = rows;
    for (let r = rows - 1; r >= 0; r--) {
      const runs = lines[r] ?? [];
      if (isChromeRow(runs, cols) || firstContentCol(runs) === null) {
        chromeTop = r;
      } else {
        break;
      }
    }
    return Math.max(MIN_FOOTER_ROWS, rows - chromeTop);
  }

  // Extend up through the box border / a blank line wrapping the prompt.
  let top = inputIdx;
  for (let r = inputIdx - 1; r >= 0; r--) {
    const runs = lines[r] ?? [];
    if (isBoxRow(runs) || firstContentCol(runs) === null) {
      top = r;
    } else {
      break;
    }
  }

  // Keep climbing through the live activity block (spinner + its todo lines) and
  // any chrome above the box, so the footer surfaces what Claude is doing while
  // it works; stops at the first real transcript row.
  for (let r = top - 1; r >= 0; r--) {
    const runs = lines[r] ?? [];
    if (
      isActivityRow(runs) ||
      isChromeRow(runs, cols) ||
      firstContentCol(runs) === null
    ) {
      top = r;
    } else {
      break;
    }
  }

  const count = rows - top;
  // Allow a tall interactive prompt (ExitPlanMode plan, AskUserQuestion options)
  // to take most of the pane so its top isn't clipped.
  const max = Math.max(MIN_FOOTER_ROWS, Math.floor(rows * 0.85));
  return Math.min(Math.max(count, MIN_FOOTER_ROWS), max);
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
