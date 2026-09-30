/**
 * Formats the instant a transcript line carries (`ConvBlock.ts`, ISO-8601 UTC
 * as Claude Code writes it) for the reading view's message headers.
 */

const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avril",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/** `21:27` in local time — `null` when the stamp is missing or unparsable. */
export function messageTime(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * The full instant for the header's tooltip — `30 sept. 2026 à 21:27:10` — so
 * the discreet `HH:MM` never hides which day a message belongs to.
 */
export function messageTimeFull(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  const ss = `${d.getSeconds()}`.padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} à ${hh}:${mm}:${ss}`;
}
