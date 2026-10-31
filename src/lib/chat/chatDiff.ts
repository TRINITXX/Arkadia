import type { JsonObject } from "@/lib/chat/chatProtocol";
import type { DiffHunk, EditPatch } from "@/lib/chat/chatToolResult";

/**
 * A file change as its card shows it: Claude Code's real diff when its
 * result carries one (line numbers, context, the hunks of a rewrite), else
 * what its input states (old and new strings, a history without results).
 */

export type DiffRow =
  | {
      kind: "add" | "del" | "ctx";
      /** Line number in the file before / after; absent when unknown. */
      old?: number;
      new?: number;
      text: string;
    }
  /** Unchanged lines skipped between two hunks. */
  | { kind: "gap"; lines: number };

export interface EditDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  /** Line numbers known: the real diff, or a new file's lines. */
  numbered: boolean;
  /** Said in place of a diff: a rewrite too large to compare. */
  note?: string;
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** A text's lines; its final newline ends the last one, adding none. */
function textLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

/** The hunks' lines, numbered, with the gaps between them. */
export function hunkRows(hunks: DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let prevOldEnd: number | null = null;
  for (const hunk of hunks) {
    if (prevOldEnd !== null && hunk.oldStart > prevOldEnd)
      rows.push({ kind: "gap", lines: hunk.oldStart - prevOldEnd });
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const line of hunk.lines) {
      const sign = line[0];
      const text = line.slice(1);
      if (sign === "+") rows.push({ kind: "add", new: newNo++, text });
      else if (sign === "-") rows.push({ kind: "del", old: oldNo++, text });
      else if (sign === " ")
        rows.push({ kind: "ctx", old: oldNo++, new: newNo++, text });
      // « \ No newline at end of file »: nothing of the file's.
    }
    prevOldEnd = hunk.oldStart + hunk.oldLines;
  }
  return rows;
}

/** What a change's input says it removes and adds, unnumbered. */
function inputRows(name: string, input: JsonObject): DiffRow[] {
  const lines = (text: string, kind: "add" | "del"): DiffRow[] =>
    textLines(text).map((t) => ({ kind, text: t }));
  if (name === "Write") return lines(s(input.content), "add");
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.flatMap((e: Record<string, unknown>) => [
      ...lines(s(e.old_string), "del"),
      ...lines(s(e.new_string), "add"),
    ]);
  }
  if (name === "NotebookEdit") return lines(s(input.new_source), "add");
  return [
    ...lines(s(input.old_string), "del"),
    ...lines(s(input.new_string), "add"),
  ];
}

function counted(rows: DiffRow[], numbered: boolean, note?: string): EditDiff {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === "add") added += 1;
    else if (row.kind === "del") removed += 1;
  }
  return { rows, added, removed, numbered, note };
}

/** A file change's diff, from its result's patch when there is one. */
export function editDiff(
  name: string,
  input: JsonObject,
  patch: EditPatch | undefined,
): EditDiff {
  if (patch && patch.hunks.length > 0)
    return counted(hunkRows(patch.hunks), true);
  // A new file: every line is new, numbered from 1. Without a result (a
  // resumed history), a Write may have replaced a file: its input, unnumbered.
  if (patch?.write === "create") {
    const rows: DiffRow[] = textLines(s(input.content)).map((text, i) => ({
      kind: "add",
      new: i + 1,
      text,
    }));
    return counted(rows, true);
  }
  if (patch?.write === "update") {
    return counted(
      [],
      false,
      patch.noDiff
        ? "Fichier réécrit : l'ancien contenu était trop gros pour être comparé"
        : "Fichier réécrit à l'identique",
    );
  }
  return counted(inputRows(name, input), false);
}
