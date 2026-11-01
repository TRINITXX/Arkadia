/** A thought's title shown at most this long. */
const MAX_TITLE = 90;

/**
 * A thinking summary's title: its bold heading (« **Lire avant d'écrire** »),
 * else its first line, shortened. Empty for empty thinking.
 */
export function thoughtTitle(text: string): string {
  const t = text.trim();
  const bold = /^\*\*(.+?)\*\*/.exec(t)?.[1];
  const line = (bold ?? t.split("\n")[0]).trim();
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}
