/** Longest first line the toast shows before cutting it short. */
const PREVIEW_MAX = 60;

/**
 * The toast that confirms "copy the last code block": how many lines landed on
 * the clipboard, then the block's first non-empty line.
 *
 * That first line is the whole point — the button copies a block you can't see
 * (the modern view is closed), so the confirmation has to be enough to tell
 * "yes, that's the command I wanted" from "wrong block, open the view".
 */
export function copiedCodeMessage(code: string): string {
  const lines = code.split("\n");
  const count = `${lines.length} ligne${lines.length > 1 ? "s" : ""}`;
  const first = lines.find((l) => l.trim() !== "")?.trim() ?? "";
  if (!first) return `Copié (${count})`;
  const preview =
    first.length > PREVIEW_MAX ? `${first.slice(0, PREVIEW_MAX)}…` : first;
  return `Copié (${count}) · ${preview}`;
}
