/**
 * A thinking summary's text without its bold heading (« **Lire avant
 * d'écrire** »), its blank lines closed up: the thinking itself, what the
 * user reads (the user's ask of 01/11/2026). A summary that is only its
 * heading keeps it, plain. Empty for empty thinking.
 */
export function thoughtBody(text: string): string {
  const t = text.trim();
  const heading = /^\*\*(.+?)\*\*\s*/.exec(t);
  const body = (heading ? t.slice(heading[0].length) : t)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  return body || (heading?.[1].trim() ?? "");
}
