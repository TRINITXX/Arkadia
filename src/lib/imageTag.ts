/** A Claude Code `[Image #N]` paste tag found in a row's plaintext. */
export interface ImageTag {
  /** The paste number, as Claude Code names the cached file (`<n>.png`). */
  n: number;
  /** Char range [start, end) of the whole tag in the row. */
  start: number;
  end: number;
}

/**
 * The `[Image #N]` tag covering char `charIdx` of `text`, or null. Claude Code
 * writes this tag in the prompt (and in the sent message) for each pasted
 * image, keeping the file in its temp dir rather than printing a path.
 */
export function imageTagAt(text: string, charIdx: number): ImageTag | null {
  for (const m of text.matchAll(/\[Image #(\d+)\]/g)) {
    const start = m.index;
    const end = start + m[0].length;
    if (charIdx >= start && charIdx < end) {
      return { n: Number(m[1]), start, end };
    }
  }
  return null;
}
