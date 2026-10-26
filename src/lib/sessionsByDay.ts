/**
 * The iPhone app's session list: one section per day, newest first, and in
 * each day one group per project folder (Alexis's request of 25/10/2026).
 * The phone does not know the projects' paths, so a session's project is the
 * folder it ran in.
 */

import {
  baseName,
  MONTHS,
  startOfDay,
  type ListedSession,
} from "@/lib/sessionsIndex";

export interface DayProject {
  /** The folder's name, the group's title. */
  name: string;
  /** Sessions of that folder that day, newest first. */
  sessions: ListedSession[];
}

export interface SessionDay {
  /** Start of the day, ms: a stable key. */
  day: number;
  /** « Aujourd'hui », « Hier », else the date. */
  label: string;
  /** « jeudi 23 oct. », with the year when it is not this one. */
  date: string;
  /** Ordered by their newest session. */
  projects: DayProject[];
}

const WEEKDAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

export function dayDate(day: number, now: number): string {
  const d = new Date(day);
  const date = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear()
    ? date
    : `${date} ${d.getFullYear()}`;
}

export function dayLabel(day: number, now: number): string {
  const today = startOfDay(now);
  if (day === today) return "Aujourd'hui";
  // Days are not all 24 h long (daylight saving): compare starts of day.
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return "Hier";
  return dayDate(day, now);
}

export function groupByDayThenProject(
  sessions: ListedSession[],
  now: number,
): SessionDay[] {
  const sorted = [...sessions].sort((a, b) => b.mtime - a.mtime);
  const days = new Map<number, Map<string, ListedSession[]>>();
  for (const s of sorted) {
    const day = startOfDay(s.mtime);
    let projects = days.get(day);
    if (!projects) days.set(day, (projects = new Map()));
    const name = baseName(s.cwd);
    const list = projects.get(name);
    if (list) list.push(s);
    else projects.set(name, [s]);
  }
  // Maps keep insertion order, which the sort made newest first.
  return [...days].map(([day, projects]) => ({
    day,
    label: dayLabel(day, now),
    date: dayDate(day, now),
    projects: [...projects].map(([name, list]) => ({ name, sessions: list })),
  }));
}
