import { describe, expect, it } from "vitest";
import type { TaskItem } from "@/lib/chat/chatState";
import { taskLine } from "@/lib/chat/chatTaskLine";

const task = (id: string, status: TaskItem["status"]): TaskItem => ({
  id,
  subject: `tâche ${id}`,
  status,
});

describe("taskLine", () => {
  it("dots the tasks done, then names the one under way and the next", () => {
    const line = taskLine([
      task("1", "completed"),
      task("2", "in_progress"),
      task("3", "pending"),
      task("4", "pending"),
    ]);
    expect(line.done.map((t) => t.id)).toEqual(["1"]);
    expect(line.current?.id).toBe("2");
    expect(line.next?.id).toBe("3");
    expect(line.open).toBe(true);
  });

  it("stays open with tasks left and none under way, never once all are done", () => {
    const paused = taskLine([task("1", "completed"), task("2", "pending")]);
    expect(paused.current).toBeNull();
    expect(paused.open).toBe(true);
    expect(taskLine([task("1", "completed")]).open).toBe(false);
    expect(taskLine([]).open).toBe(false);
  });
});
