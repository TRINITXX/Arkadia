import { folderOf } from "@/lib/chat/chatLabels";

/**
 * Reminders `rappel.mjs` leaves for Arkadia (`src-tauri/src/reminders.rs`):
 * those that fell due wait beside the sidebar (« Rappels »), each launched
 * in a new chat of its conversation's project or put off to tomorrow.
 */
export interface Reminder {
  id: string;
  /** The conversation (project) its prompt is for. */
  conversation: string;
  subject: string;
  prompt: string;
  /** ISO UTC. */
  at: string;
  createdAt?: string | null;
}

const isReminder = (x: unknown): x is Reminder => {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return ["id", "conversation", "subject", "prompt", "at"].every(
    (key) => typeof r[key] === "string",
  );
};

/** What `reminders_list` returned, its malformed entries left out. */
export function readReminders(raw: unknown): Reminder[] {
  return Array.isArray(raw) ? raw.filter(isReminder) : [];
}

/** Those due at `now` (epoch ms), the oldest first. */
export function dueReminders(
  reminders: readonly Reminder[],
  now: number,
): Reminder[] {
  return reminders
    .filter((r) => Date.parse(r.at) <= now)
    .sort(
      (a, b) =>
        Date.parse(a.at) - Date.parse(b.at) ||
        a.subject.localeCompare(b.subject),
    );
}

/** « Demain »: tomorrow at 9:00 local time, as ISO UTC. */
export function tomorrowAtNine(now: Date): string {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    9,
  ).toISOString();
}

/** The subject without its « Rappel : » (the list says it already), its
 *  first letter up: « lire la sonde » reads « Lire la sonde ». */
export function reminderTitle(subject: string): string {
  const title = subject.replace(/^\s*rappel\s*:\s*/i, "") || subject;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** « Arkadia · prévu à 9 h » today, else « … · prévu le 15/11 à 9 h 30 ». */
export function reminderSubtitle(reminder: Reminder, now: Date): string {
  const at = new Date(reminder.at);
  const hour =
    at.getMinutes() === 0
      ? `${at.getHours()} h`
      : `${at.getHours()} h ${pad(at.getMinutes())}`;
  const when =
    at.toDateString() === now.toDateString()
      ? `prévu à ${hour}`
      : `prévu le ${pad(at.getDate())}/${pad(at.getMonth() + 1)} à ${hour}`;
  return `${reminder.conversation} · ${when}`;
}

/** « 1 rappel à lancer », « 3 rappels à lancer ». */
export function remindersHeader(count: number): string {
  return `${count} rappel${count > 1 ? "s" : ""} à lancer`;
}

/** Case and accents aside: « Énergie » is « energie ». */
const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Where a reminder's prompt goes when its conversation names no project. */
export const FALLBACK_PROJECT = "Claude Desktop";

/** The project named `name`, else the one whose folder is named so. */
export function projectNamed<P extends { name: string; path: string }>(
  projects: readonly P[],
  name: string,
): P | null {
  const wanted = fold(name);
  if (!wanted) return null;
  return (
    projects.find((p) => fold(p.name) === wanted) ??
    projects.find((p) => fold(folderOf(p.path)) === wanted) ??
    null
  );
}

/**
 * Where « Lancer » opens a reminder: its conversation's project, else
 * « Claude Desktop » (`fallback`); null when neither exists.
 */
export function reminderProject<P extends { name: string; path: string }>(
  projects: readonly P[],
  conversation: string,
): { project: P; fallback: boolean } | null {
  const own = projectNamed(projects, conversation);
  if (own) return { project: own, fallback: false };
  const fallback = projectNamed(projects, FALLBACK_PROJECT);
  return fallback ? { project: fallback, fallback: true } : null;
}
