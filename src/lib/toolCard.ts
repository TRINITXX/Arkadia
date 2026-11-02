import type { DiffRow, EditDiff } from "@/lib/chat/chatDiff";

/**
 * What a tool card of the reading view says of its input, shared by the
 * desktop's `ToolCard` and the iPhone's Messages tab: the parsed input, the
 * change an edit makes, the +/- counter of its header.
 */

/** Parses the tool input JSON; `{}` on failure or non-object. */
export function parseToolInput(json?: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export interface TrimmedDiff {
  before: string[];
  removed: string[];
  added: string[];
  after: string[];
}

/**
 * Trims the common leading/trailing lines between `oldText` and `newText` so a
 * diff shows only what actually changed (+ 2 lines of context), like a terminal
 * unified diff — not the whole block dumped twice.
 */
export function trimmedDiff(oldText: string, newText: string): TrimmedDiff {
  const o = oldText.length ? oldText.split("\n") : [];
  const n = newText.length ? newText.split("\n") : [];
  let start = 0;
  while (start < o.length && start < n.length && o[start] === n[start]) start++;
  let endO = o.length;
  let endN = n.length;
  while (endO > start && endN > start && o[endO - 1] === n[endN - 1]) {
    endO--;
    endN--;
  }
  return {
    before: o.slice(Math.max(0, start - 2), start),
    removed: o.slice(start, endO),
    added: n.slice(start, endN),
    after: o.slice(endO, endO + 2),
  };
}

/** The trimmed diff as the phone's diff rows draw it (`DiffRows`), unnumbered. */
export function trimmedEditDiff(oldText: string, newText: string): EditDiff {
  const d = trimmedDiff(oldText, newText);
  const rows = (lines: string[], kind: "add" | "del" | "ctx"): DiffRow[] =>
    lines.map((line) => ({ kind, text: line }));
  return {
    rows: [
      ...rows(d.before, "ctx"),
      ...rows(d.removed, "del"),
      ...rows(d.added, "add"),
      ...rows(d.after, "ctx"),
    ],
    added: d.added.length,
    removed: d.removed.length,
    numbered: false,
  };
}

/** A MultiEdit's edits, each as its old and new strings. */
export function multiEdits(
  input: Record<string, unknown>,
): { oldText: string; newText: string }[] {
  const edits = Array.isArray(input.edits) ? input.edits : [];
  return edits.map((e) => {
    const eo = (e ?? {}) as Record<string, unknown>;
    return { oldText: text(eo.old_string), newText: text(eo.new_string) };
  });
}

/** "+5 −1" style change counter for a tool card header. */
function statStr(removed: number, added: number): string {
  const parts: string[] = [];
  if (added) parts.push(`+${added}`);
  if (removed) parts.push(`−${removed}`);
  return parts.join(" ");
}

export function toolStat(name: string, input: Record<string, unknown>): string {
  if (name === "Edit") {
    const d = trimmedDiff(text(input.old_string), text(input.new_string));
    return statStr(d.removed.length, d.added.length);
  }
  if (name === "MultiEdit") {
    let rem = 0;
    let add = 0;
    for (const e of multiEdits(input)) {
      const d = trimmedDiff(e.oldText, e.newText);
      rem += d.removed.length;
      add += d.added.length;
    }
    return statStr(rem, add);
  }
  if (name === "Write") {
    const c = text(input.content);
    return c ? `+${c.split("\n").length}` : "";
  }
  return "";
}
