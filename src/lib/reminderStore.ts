import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  dueReminders,
  readReminders,
  tomorrowAtNine,
  type Reminder,
} from "@/lib/reminders";

/**
 * The reminders folder as Arkadia reads it: at its start, then every minute
 * (`startReminderPolling`, from App: the sidebar may be folded), Arkadia not
 * being open all the time. The ones due, and those being launched, for the
 * sidebar's « Rappels » and the dot of the folded sidebar's button.
 */
export interface ReminderView {
  due: readonly Reminder[];
  /** When `due` was worked out (epoch ms): « prévu à » reads today from it. */
  now: number;
  /** Ids « Lancer » is opening: their buttons wait. */
  launching: ReadonlySet<string>;
}

const POLL_MS = 60_000;

let all: readonly Reminder[] = [];
let launching: ReadonlySet<string> = new Set();
let view: ReminderView = { due: [], now: Date.now(), launching };
const listeners = new Set<() => void>();
/**
 * Bumped by « Lancer » and « Demain », before and after they write: a read
 * of the folder started before the latest bump may predate them, so it is
 * dropped, never shown over them.
 */
let generation = 0;

function recompute(): void {
  const now = Date.now();
  view = { due: dueReminders(all, now), now, launching };
  for (const l of listeners) l();
}

/** The folder's reminders as read (the dev preview gives its own). */
export function publishReminders(next: readonly Reminder[]): void {
  all = next;
  recompute();
}

/** Reads the folder again; on a failure the list stays, time moves on. */
export function refreshReminders(): Promise<void> {
  const started = generation;
  return invoke<unknown>("reminders_list").then(
    (raw) => {
      if (started === generation) publishReminders(readReminders(raw));
      else recompute();
    },
    () => recompute(),
  );
}

/** Reads the folder now, then every minute, until the returned stop. */
export function startReminderPolling(): () => void {
  void refreshReminders();
  const timer = setInterval(() => void refreshReminders(), POLL_MS);
  return () => clearInterval(timer);
}

export function reminderView(): ReminderView {
  return view;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useReminders(): ReminderView {
  return useSyncExternalStore(subscribe, reminderView);
}

function setLaunching(id: string, on: boolean): void {
  const next = new Set(launching);
  if (on) next.add(id);
  else next.delete(id);
  launching = next;
  recompute();
}

/**
 * « Lancer »: the reminder is claimed first (its file moves to `done\`, a
 * claim that fails once another took it), then `open` starts its chat. A
 * refused claim opens nothing and reads the folder again; a chat that could
 * not open gives the reminder back.
 */
export async function launchReminder(
  reminder: Reminder,
  open: () => Promise<boolean>,
): Promise<void> {
  const { id } = reminder;
  if (launching.has(id)) return;
  generation++;
  setLaunching(id, true);
  try {
    try {
      await invoke("reminder_claim", { id });
    } catch (e) {
      console.error("[reminders] claim", e);
      generation++;
      await refreshReminders();
      return;
    }
    all = all.filter((r) => r.id !== id);
    let opened = false;
    try {
      opened = await open();
    } catch (e) {
      console.error("[reminders] open", e);
    }
    if (!opened) {
      await invoke("reminder_unclaim", { id }).catch((e: unknown) =>
        console.error("[reminders] unclaim", e),
      );
      generation++;
      await refreshReminders();
    }
  } finally {
    generation++;
    setLaunching(id, false);
  }
}

/**
 * « Tout lancer »: each reminder in turn, one chat each, in the list's order.
 * `open` gives null for a reminder no project fits: it stays in the list.
 * One run at a time, the sidebar folded and unfolded meanwhile included.
 * Each reminder is checked against the list as it is now: one put off or
 * launched by its own row while the others open is left alone.
 */
let launchingAll = false;
export async function launchReminders(
  reminders: readonly Reminder[],
  open: (reminder: Reminder) => (() => Promise<boolean>) | null,
): Promise<void> {
  if (launchingAll) return;
  launchingAll = true;
  try {
    for (const reminder of reminders) {
      if (!view.due.some((r) => r.id === reminder.id)) continue;
      if (launching.has(reminder.id)) continue;
      const opener = open(reminder);
      if (opener) await launchReminder(reminder, opener);
    }
  } finally {
    launchingAll = false;
  }
}

/** « Demain »: due again tomorrow at 9:00, out of the list till then. */
export async function postponeReminder(reminder: Reminder): Promise<void> {
  const at = tomorrowAtNine(new Date());
  generation++;
  publishReminders(all.map((r) => (r.id === reminder.id ? { ...r, at } : r)));
  try {
    await invoke("reminder_postpone", { id: reminder.id, at });
    generation++;
  } catch (e) {
    console.error("[reminders] postpone", e);
    generation++;
    await refreshReminders();
  }
}
