/**
 * Renders picked photo paths as the text typed into Claude Code's prompt.
 *
 * Every path is double-quoted: the camera roll lives under `iCloud Photos`, so
 * an unquoted path would read as two arguments and the model would go looking
 * for a file that doesn't exist. Windows forbids `"` in file names, so wrapping
 * needs no escaping. A trailing space lets the user keep typing their request
 * straight after, and nothing is submitted — the caller sends no `\r`.
 */
export function quotePathsForPrompt(paths: string[]): string {
  if (paths.length === 0) return "";
  return `${paths.map((p) => `"${p}"`).join(" ")} `;
}

/**
 * The chat's take on it: the picked paths go into the draft at the caret
 * (over the selection), or at the end when the input has none. A space keeps
 * them off a word typed just before. Returns the caret after the insertion.
 */
export function insertPathsInDraft(
  text: string,
  paths: string[],
  caret: { start: number; end: number } | null,
): { text: string; caret: number } {
  const start = Math.min(caret?.start ?? text.length, text.length);
  const end = Math.min(Math.max(caret?.end ?? start, start), text.length);
  const quoted = quotePathsForPrompt(paths);
  if (!quoted) return { text, caret: start };
  const before = text.slice(0, start);
  const inserted = (before && !/\s$/.test(before) ? " " : "") + quoted;
  return {
    text: before + inserted + text.slice(end),
    caret: start + inserted.length,
  };
}
