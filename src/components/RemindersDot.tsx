import { remindersHeader } from "@/lib/reminders";
import { useReminders } from "@/lib/reminderStore";

/**
 * The due reminders' count, an amber dot on the button that unfolds the
 * sidebar while it is folded: its « Rappels » is out of sight.
 */
export function RemindersDot() {
  const { due } = useReminders();
  if (due.length === 0) return null;
  return (
    <span
      title={remindersHeader(due.length)}
      className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400 px-[3px] text-[9px] font-semibold leading-none text-zinc-950"
    >
      {due.length}
    </span>
  );
}
