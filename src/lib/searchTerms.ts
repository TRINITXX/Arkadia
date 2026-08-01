/**
 * How a search query is split, and where its terms land in a piece of text.
 *
 * The splitting mirrors `sessions.rs::query_terms` exactly: the backend decides
 * which sessions surface, and the frontend paints what matched, so the two must
 * agree on what "a term" is or the highlight contradicts the result.
 *
 * Terms are matched as plain case-insensitive substrings, never as words —
 * `identifiant` is expected to light up inside `identifiants`, which is also
 * what the Rust side counts.
 */

/** Shortest query worth searching, mirroring `MIN_QUERY` on the Rust side. */
const MIN_QUERY = 2;

/**
 * The terms every matching message must contain, lowercased and deduplicated.
 * Empty for a query too short to search — the caller then highlights nothing.
 */
export function queryTerms(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];
  return [...new Set(q.split(/\s+/).filter(Boolean))];
}

/** One run of text, tagged with the term that produced it (null = no match). */
export interface Segment {
  text: string;
  /** Which term matched, so the caller can colour a user term and an AI-
   *  suggested one differently. */
  term: string | null;
}

/**
 * Splits `text` into alternating plain and matching runs, ready to render as
 * `<mark>`s. Overlapping terms are resolved left to right, longest first, so
 * searching "mot de passe" alongside "passe" never produces nested marks.
 */
export function segmentByTerms(text: string, terms: string[]): Segment[] {
  if (!text || terms.length === 0) return [{ text, term: null }];
  const hay = text.toLowerCase();
  // Longest first: at a given offset the widest term wins, which keeps
  // "mot de passe" whole instead of painting only its "passe".
  const ordered = [...terms]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const out: Segment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const hit = ordered.find((t) => hay.startsWith(t, i));
    if (hit === undefined) {
      plain += text[i];
      i += 1;
      continue;
    }
    if (plain) {
      out.push({ text: plain, term: null });
      plain = "";
    }
    out.push({ text: text.slice(i, i + hit.length), term: hit });
    i += hit.length;
  }
  if (plain) out.push({ text: plain, term: null });
  return out.length > 0 ? out : [{ text, term: null }];
}

/**
 * Total term occurrences in `text` — the same unit as the row's "12×" badge
 * and the reader's occurrence counter.
 */
export function countTerms(text: string, terms: string[]): number {
  return segmentByTerms(text, terms).filter((s) => s.term !== null).length;
}

/** True when a single message satisfies the search: every term is present. */
export function matchesAllTerms(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const hay = text.toLowerCase();
  return terms.every((t) => hay.includes(t));
}
