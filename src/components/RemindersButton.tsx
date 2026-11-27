import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, X } from "lucide-react";
import {
  reminderProject,
  remindersHeader,
  reminderSubtitle,
  reminderTitle,
  type Reminder,
} from "@/lib/reminders";
import {
  dismissReminder,
  launchReminder,
  launchReminders,
  postponeReminder,
  useReminders,
} from "@/lib/reminderStore";
import type { Project } from "@/types";

interface RemindersButtonProps {
  projects: Project[];
  /** Opens a new chat tab in `project` and sends `prompt` as its first
   *  message; false when the tab could not open. */
  onLaunch: (project: Project, prompt: string) => Promise<boolean>;
}

/** Where the list opens: beside the sidebar, its bottom on the button's. */
interface Place {
  left: number;
  bottom: number;
  maxHeight: number;
}

/**
 * The sidebar's « Rappels », above « Sessions récentes », while a reminder
 * is due (`reminderStore`). Its list opens beside the sidebar: « Lancer »
 * opens a new chat in the reminder's project with its prompt, « Demain »
 * puts it off to tomorrow at 9:00, « × » drops it without a chat. Escape or
 * a click outside closes it.
 */
export function RemindersButton({ projects, onLaunch }: RemindersButtonProps) {
  const { due, now, launching } = useReminders();
  const [place, setPlace] = useState<Place | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [launchingAll, setLaunchingAll] = useState(false);
  // « Tout lancer » runs past the last chat it opens: no state after unmount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const open = place !== null && due.length > 0;

  // The last one launched or put off: the list closes with the button.
  useEffect(() => {
    if (due.length === 0) setPlace(null);
  }, [due.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (listRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setPlace(null);
    };
    // Captured, and kept from the rest: a chat's Esc would stop Claude.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPlace(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (due.length === 0) return null;

  const opener = (reminder: Reminder) => {
    const target = reminderProject(projects, reminder.conversation);
    return target ? () => onLaunch(target.project, reminder.prompt) : null;
  };
  const launchable = due.filter(
    (r) => !launching.has(r.id) && reminderProject(projects, r.conversation),
  ).length;
  const launchAll = async () => {
    setLaunchingAll(true);
    try {
      await launchReminders(
        due.filter((r) => !launching.has(r.id)),
        opener,
      );
    } finally {
      if (mounted.current) setLaunchingAll(false);
    }
  };

  const toggle = () => {
    const button = buttonRef.current;
    if (open || !button) {
      setPlace(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    const side = button.closest("aside")?.getBoundingClientRect().right;
    setPlace({
      left: (side ?? rect.right) + 8,
      bottom: window.innerHeight - rect.bottom,
      maxHeight: Math.max(120, rect.bottom - 8),
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="Rappels arrivés à échéance"
        className="flex items-center justify-center gap-1.5 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-xs text-amber-200 hover:bg-amber-400/20"
      >
        <Bell size={13} className="shrink-0" />
        Rappels
        <span className="rounded bg-amber-400/80 px-1.5 text-[10px] font-semibold text-zinc-950">
          {due.length}
        </span>
      </button>
      {open &&
        // Portalled to <body>: inside the sidepanel (a .chrome-surface) the
        // glass background preset would turn its fill translucent.
        createPortal(
          <div
            ref={listRef}
            className="fixed z-40 w-[320px] overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 p-2 text-xs shadow-2xl"
            style={{
              left: place.left,
              bottom: place.bottom,
              maxHeight: place.maxHeight,
            }}
          >
            <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-0.5">
              <span className="min-w-0 flex-1 text-[11px] text-zinc-500">
                {remindersHeader(due.length)}
              </span>
              {launchable >= 2 && (
                <button
                  type="button"
                  disabled={launchingAll}
                  onClick={() => void launchAll()}
                  title="Une nouvelle conversation par rappel, chacun dans son projet"
                  className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-400/20 disabled:opacity-40"
                >
                  Tout lancer
                </button>
              )}
            </div>
            {due.map((reminder) => (
              <ReminderRow
                key={reminder.id}
                reminder={reminder}
                subtitle={reminderSubtitle(reminder, new Date(now))}
                target={reminderProject(projects, reminder.conversation)}
                launching={launching.has(reminder.id)}
                onLaunch={(project) =>
                  void launchReminder(reminder, () =>
                    onLaunch(project, reminder.prompt),
                  )
                }
              />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function ReminderRow({
  reminder,
  subtitle,
  target,
  launching,
  onLaunch,
}: {
  reminder: Reminder;
  subtitle: string;
  /** Where « Lancer » opens it; null when no project fits. */
  target: { project: Project; fallback: boolean } | null;
  launching: boolean;
  onLaunch: (project: Project) => void;
}) {
  const title = reminderTitle(reminder.subject);
  const project = target?.project ?? null;
  const launchTip = !target
    ? `Projet « ${reminder.conversation} » introuvable, et pas de projet « Claude Desktop »`
    : target.fallback
      ? `Projet « ${reminder.conversation} » introuvable : nouvelle conversation dans ${target.project.name}`
      : `Nouvelle conversation dans ${target.project.name}, le rappel en premier message`;
  return (
    <div
      className="flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-zinc-800"
      title={`${title}\n${subtitle}`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-zinc-100">{title}</div>
        <div className="truncate text-[11px] text-zinc-500">{subtitle}</div>
      </div>
      <button
        type="button"
        disabled={!project || launching}
        onClick={() => project && onLaunch(project)}
        title={launchTip}
        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-100 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800"
      >
        Lancer
      </button>
      <button
        type="button"
        disabled={launching}
        onClick={() => void postponeReminder(reminder)}
        title="Le reporter à demain 9 h"
        className="rounded px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40"
      >
        Demain
      </button>
      <button
        type="button"
        disabled={launching}
        onClick={() => void dismissReminder(reminder)}
        title="Supprimer ce rappel sans le lancer"
        aria-label="Supprimer ce rappel"
        className="-ml-1 rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40"
      >
        <X size={13} />
      </button>
    </div>
  );
}
