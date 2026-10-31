import { dayKey, dayLabel } from "@/lib/messageTime";

/**
 * Where the column marks a new day: before the first dated row of each day.
 * The first day gets its mark too unless it is today, so an old conversation
 * says which day it was; a conversation of today alone shows none. Rows
 * without a time (an old transcript's) belong to the day before them.
 */
export function dayBreaks(
  times: readonly (number | undefined)[],
  now: number = Date.now(),
): Map<number, string> {
  const breaks = new Map<number, string>();
  let last: string | null = null;
  times.forEach((at, i) => {
    if (at === undefined) return;
    const key = dayKey(at);
    if (key === last) return;
    if (last !== null || key !== dayKey(now)) breaks.set(i, dayLabel(at, now));
    last = key;
  });
  return breaks;
}

/** A day's mark among the column's rows. */
export interface DayRow {
  kind: "day";
  id: string;
  label: string;
}

/** The rows with each new day's mark before its first one (`dayBreaks`). */
export function withDayBreaks<T>(
  rows: readonly T[],
  timeOf: (row: T) => number | undefined,
  now: number = Date.now(),
): (T | DayRow)[] {
  const breaks = dayBreaks(rows.map(timeOf), now);
  if (breaks.size === 0) return rows.slice();
  return rows.flatMap((row, i) => {
    const label = breaks.get(i);
    return label === undefined
      ? [row]
      : [{ kind: "day" as const, id: `day:${i}:${label}`, label }, row];
  });
}
