// The prose an image illustrates, read off the message that mentions it, so
// the lightbox can show it above the full-size image the way the conversation
// shows it above the inline one.

import { imagePathKey, splitImagePaths } from "@/lib/imagePaths";

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING_RE = /^ {0,3}#{1,6}(?:\s|$)/;
const TABLE_ROW_RE = /^\s*\|/;
const RULE_RE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

/**
 * The caption of each image path `text` mentions, keyed by `imagePathKey`:
 * the prose of the paragraph, list item or table row that holds the path or,
 * for a path standing alone, the closest line of prose above it. A path inside
 * a fenced code block gets none; the first mention that yields one wins.
 */
export function imageCaptions(
  text: string,
  baseDir?: string | null,
): Map<string, string> {
  const out = new Map<string, string>();
  const segments = splitImagePaths(text, baseDir);
  if (!segments.some((seg) => seg.path)) return out;
  const lines = text.split("\n");
  const fenced = fencedLines(lines);
  let at = 0;
  for (const seg of segments) {
    const key = seg.path ? imagePathKey(seg.path) : null;
    if (key && !out.has(key)) {
      const line = text.slice(0, at).split("\n").length - 1;
      const caption = captionAt(lines, fenced, line, baseDir);
      if (caption) out.set(key, caption);
    }
    at += seg.text.length;
  }
  return out;
}

function captionAt(
  lines: string[],
  fenced: boolean[],
  i: number,
  baseDir?: string | null,
): string {
  if (fenced[i]) return "";
  if (TABLE_ROW_RE.test(lines[i])) {
    return lines[i]
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => prose([cell], baseDir))
      .filter(Boolean)
      .join(" · ");
  }
  // The paragraph or list item around the path: a list marker or a heading
  // opens a new one, a blank line, a fence, a table or a rule closes it.
  const joins = (j: number) =>
    !fenced[j] &&
    lines[j].trim() !== "" &&
    !TABLE_ROW_RE.test(lines[j]) &&
    !RULE_RE.test(lines[j]) &&
    !HEADING_RE.test(lines[j]);
  // A heading is one line on its own.
  const heading = HEADING_RE.test(lines[i]);
  let start = i;
  while (start > 0 && !opensBlock(lines[start]) && joins(start - 1)) start--;
  let end = i;
  while (
    !heading &&
    end + 1 < lines.length &&
    joins(end + 1) &&
    !opensBlock(lines[end + 1])
  )
    end++;
  const own = prose(lines.slice(start, end + 1), baseDir);
  if (own) return own;
  // A path on its own illustrates the line written just above it.
  for (let j = start - 1; j >= 0; j--) {
    if (fenced[j] || TABLE_ROW_RE.test(lines[j]) || RULE_RE.test(lines[j])) {
      return "";
    }
    const above = prose([lines[j]], baseDir);
    if (above) return above;
  }
  return "";
}

function opensBlock(line: string): boolean {
  return LIST_ITEM_RE.test(line) || HEADING_RE.test(line);
}

/**
 * `lines` as plain text: image paths and markdown syntax removed. Inline code
 * keeps its content verbatim, as the conversation shows it.
 */
function prose(lines: string[], baseDir?: string | null): string {
  return lines
    .map((line) =>
      splitImagePaths(line, baseDir)
        .filter((seg) => !seg.path)
        .map((seg) => seg.text)
        .join(" ")
        .replace(/^\s*(?:>\s*)+/, "")
        .replace(/^ {0,3}#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, ""),
    )
    .join(" ")
    .split(/(`[^`]*`)/)
    .map((part, n) =>
      n % 2 === 1
        ? part.slice(1, -1)
        : part
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, "$1")
            .replace(/\*\*|__|~~|`|\*/g, ""),
    )
    .join("")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,·–—-]+|[\s:;,·–—-]+$/g, "");
}

/** Which lines belong to a fenced code block, fence lines included. */
function fencedLines(lines: string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const m = FENCE_RE.exec(line);
    if (fence === null) {
      if (!m) return false;
      fence = m[1];
      return true;
    }
    if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    return true;
  });
}
