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

const WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** Local `y-m-d` of an instant: two instants of one day share it. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * A day for the chat's separators: `Aujourd'hui`, `Hier`, else
 * `lun. 27 oct.`, the year added when it isn't this one.
 */
export function dayLabel(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  if (dayKey(ms) === dayKey(now)) return "Aujourd'hui";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(ms) === dayKey(yesterday.getTime())) return "Hier";
  const year =
    d.getFullYear() === new Date(now).getFullYear()
      ? ""
      : ` ${d.getFullYear()}`;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}
