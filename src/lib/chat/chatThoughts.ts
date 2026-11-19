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

/** Short words that give a thought's tongue away. */
const FRENCH_WORDS =
  /\b(je|tu|te|ton|ta|tes|le|la|les|des|du|une|est|sont|que|qui|pour|pas|dans|sur|avec|et|au|aux|ce|cette|il|ne|se|ses|mais|puis|donc)\b/gi;
const ENGLISH_WORDS =
  /\b(i'm|i'll|i've|i|the|and|is|are|to|of|that|for|with|this|it|my|be|not|but|then|so|next|now|whether)\b/gi;

/**
 * A thought in Claude's own French words, not the API's English summary of
 * his thinking: often what he meant to tell the user and never wrote in a
 * reply (four answers lost from 16 to 19/11/2026). The terminal showed every
 * thought in full, so the user read them anyway.
 */
export function saidInFrench(text: string): boolean {
  const french = text.match(FRENCH_WORDS)?.length ?? 0;
  const english = text.match(ENGLISH_WORDS)?.length ?? 0;
  return french >= 3 && french > english * 2;
}

/**
 * The thoughts of a run drawn in full where they came: those in Claude's
 * French words (the user's pick of 19/11/2026), and while Claude works, the
 * latest whatever its tongue (« Récit »). The others stay behind the bulb.
 */
export function thoughtsInFull<T extends { text: string }>(
  items: readonly T[],
  live: boolean,
): T[] {
  const latest = live
    ? [...items].reverse().find((item) => thoughtBody(item.text))
    : undefined;
  return items.filter(
    (item) =>
      item === latest || (thoughtBody(item.text) && saidInFrench(item.text)),
  );
}

/**
 * Each run's thoughts in full (`thoughtsInFull`, `live`: the run drawn
 * while Claude works), by run, read once per change of the column: a bulb
 * leaves these out, never showing a thought twice.
 */
export function fullThoughts<T extends { id: string; text: string }>(
  runs: Iterable<{ id: string; items: readonly T[] }>,
  live: string | null,
): { byRun: Map<string, T[]>; ids: Set<string> } {
  const byRun = new Map<string, T[]>();
  const ids = new Set<string>();
  for (const run of runs) {
    const full = thoughtsInFull(run.items, run.id === live);
    if (full.length === 0) continue;
    byRun.set(run.id, full);
    for (const item of full) ids.add(item.id);
  }
  return { byRun, ids };
}
