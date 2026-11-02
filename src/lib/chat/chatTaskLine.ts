import type { TaskItem } from "@/lib/chat/chatState";

/**
 * Claude's task list as the live line shows it, on the PC and on the iPhone
 * (the user's pick B of 01/11/2026): a green dot per task done, the one under
 * way, what comes next, never « 3 sur 7 » (the list changes on the way).
 */
export interface TaskLine {
  /** A green dot each, in the list's order. */
  done: TaskItem[];
  /** The task under way: its dot, and the line's words. */
  current: TaskItem | null;
  /** The first still to do: « ensuite : … ». */
  next: TaskItem | null;
  /** Tasks left to do: the line stays while Claude rests (between two, paused). */
  open: boolean;
}

export function taskLine(tasks: TaskItem[]): TaskLine {
  const done = tasks.filter((t) => t.status === "completed");
  return {
    done,
    current: tasks.find((t) => t.status === "in_progress") ?? null,
    next: tasks.find((t) => t.status === "pending") ?? null,
    open: tasks.length > 0 && done.length < tasks.length,
  };
}
