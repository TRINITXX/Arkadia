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
