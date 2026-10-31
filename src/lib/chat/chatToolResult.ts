import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * What a tool's structured result (`tool_use_result`, the SDK user message's
 * wrapper field) adds to its text: a file change's real diff, a command's
 * output and errors apart and how it ended. Only what the column shows is
 * kept: never a file's whole old content.
 */

/** A hunk of Claude Code's `structuredPatch` (the `diff` package's). */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Each line with its sign first: " " context, "-" removed, "+" added. */
  lines: string[];
}

export interface EditPatch {
  hunks: DiffHunk[];
  /** Write: a new file (`create`), or one rewritten (`update`). */
  write?: "create" | "update";
  /** A rewrite whose old content was too large to compare. */
  noDiff?: boolean;
}

/**
 * A command's output. A failed one (exit code not 0) comes back as one text,
 * its streams already mixed: only its code is known then, no streams.
 */
export interface ShellOutput {
  stdout?: string;
  stderr?: string;
  /** A failed command's exit code. */
  exitCode?: number;
  /** Cut short (Esc, or the turn interrupted). */
  interrupted?: boolean;
  /** Past its timeout, then left running in the background. */
  timedOutMs?: number;
  /** Running in the background: launched there, or sent there by Ctrl+B. */
  background?: "launched" | "user";
  /** Claude Code's reading of a special exit code (« no match »). */
  note?: string;
  /** Too long to keep inline: where Claude Code saved all of it. */
  savedTo?: string;
}

export interface ToolDetail {
  patch?: EditPatch;
  shell?: ShellOutput;
}

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** A diff's lines kept per change, past which its tail is dropped. */
const PATCH_LINES = 3000;
/** Each of a command's streams, kept up to this (the row shows less). */
const STREAM_CHARS = 20_000;

const EDITS = new Set(["Edit", "MultiEdit", "Write"]);
/** How Claude Code's result of a failed command begins. */
const EXIT_CODE = /^Error: Exit code (\d+)/;
const SHELLS = new Set(["Bash", "PowerShell"]);

function readHunks(v: unknown): DiffHunk[] {
  if (!Array.isArray(v)) return [];
  let budget = PATCH_LINES;
  const hunks: DiffHunk[] = [];
  for (const raw of v) {
    const h = obj(raw);
    const oldStart = num(h.oldStart);
    const newStart = num(h.newStart);
    if (oldStart === undefined || newStart === undefined || budget <= 0)
      continue;
    const lines = (Array.isArray(h.lines) ? h.lines : [])
      .filter((l): l is string => typeof l === "string")
      .slice(0, budget);
    budget -= lines.length;
    hunks.push({
      oldStart,
      oldLines: num(h.oldLines) ?? 0,
      newStart,
      newLines: num(h.newLines) ?? 0,
      lines,
    });
  }
  return hunks;
}

function cap(text: string): string {
  return text.length > STREAM_CHARS
    ? `${text.slice(0, STREAM_CHARS)}\n…`
    : text;
}

/** Claude Code's own note in stderr, no error of the command's. */
const CWD_RESET = /^Shell cwd was reset to .*$/gm;

function shellNotes(stderr: string): string {
  return stderr.replace(CWD_RESET, "").trim();
}

/** The parts of a tool's structured result the column shows; none else. */
export function toolDetail(name: string, raw: unknown): ToolDetail | undefined {
  const r = obj(raw);
  if (EDITS.has(name)) {
    const hunks = readHunks(r.structuredPatch);
    const write =
      r.type === "create" || r.type === "update" ? r.type : undefined;
    if (hunks.length === 0 && !write) return undefined;
    return {
      patch: {
        hunks,
        write,
        // An update with no old content and no hunk: too large to compare.
        noDiff:
          (write === "update" &&
            hunks.length === 0 &&
            r.originalFile === null) ||
          undefined,
      },
    };
  }
  if (!SHELLS.has(name)) return undefined;
  // A failed command: Claude Code's error text, its streams mixed in it.
  const failed = typeof raw === "string" ? EXIT_CODE.exec(raw) : null;
  if (failed) return { shell: { exitCode: Number(failed[1]) } };
  if ("stdout" in r || "stderr" in r) {
    const timedOutMs = num(r.timedOutAfterMs);
    // A timeout sends it to the background too: its mark says both.
    const background =
      r.backgroundedByUser === true
        ? "user"
        : str(r.backgroundTaskId) && timedOutMs === undefined
          ? "launched"
          : undefined;
    return {
      shell: {
        stdout: cap(str(r.stdout) ?? ""),
        stderr: cap(shellNotes(str(r.stderr) ?? "")),
        interrupted: r.interrupted === true || undefined,
        timedOutMs,
        background,
        note: str(r.returnCodeInterpretation) || undefined,
        savedTo: str(r.persistedOutputPath) || undefined,
      },
    };
  }
  return undefined;
}

/** A command's marks, as the row shows them after its words. */
export function shellMarks(shell: ShellOutput): string[] {
  const marks: string[] = [];
  if (shell.exitCode !== undefined) marks.push(`code ${shell.exitCode}`);
  if (shell.interrupted) marks.push("coupée");
  if (shell.timedOutMs !== undefined) {
    const s = Math.round(shell.timedOutMs / 1000);
    marks.push(`délai dépassé (${s} s)`, "passée en fond");
  } else if (shell.background === "user") {
    marks.push("passée en fond");
  } else if (shell.background === "launched") {
    marks.push("en fond");
  }
  if (shell.savedTo) marks.push("sortie tronquée");
  return marks;
}
