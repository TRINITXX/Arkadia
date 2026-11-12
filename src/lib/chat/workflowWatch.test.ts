import { describe, expect, it } from "vitest";
import { endedWorkflows } from "../../../chat-server/workflowWatch.ts";

const system = (subtype: string, extra: Record<string, unknown> = {}) => ({
  type: "system",
  subtype,
  ...extra,
});

describe("endedWorkflows", () => {
  const watched = ["w1", "w2"];

  it("ends a watched workflow on its notification or an update that ends it", () => {
    expect(
      endedWorkflows(system("task_notification", { task_id: "w1" }), watched),
    ).toEqual(["w1"]);
    expect(
      endedWorkflows(
        system("task_updated", { task_id: "w2", patch: { status: "killed" } }),
        watched,
      ),
    ).toEqual(["w2"]);
    // Sent to the background, another task's end: still watched.
    expect(
      endedWorkflows(
        system("task_updated", {
          task_id: "w1",
          patch: { is_backgrounded: true },
        }),
        watched,
      ),
    ).toEqual([]);
    expect(
      endedWorkflows(system("task_notification", { task_id: "a1" }), watched),
    ).toEqual([]);
  });

  it("ends the watched workflows the live background set lacks", () => {
    const set = (ids: string[]) =>
      system("background_tasks_changed", {
        tasks: ids.map((task_id) => ({ task_id })),
      });
    expect(endedWorkflows(set(["w1", "b1"]), watched)).toEqual(["w2"]);
    expect(endedWorkflows(set([]), watched)).toEqual(["w1", "w2"]);
  });

  it("leaves them alone on any other message", () => {
    expect(
      endedWorkflows(system("task_progress", { task_id: "w1" }), watched),
    ).toEqual([]);
    expect(endedWorkflows({ type: "assistant" }, watched)).toEqual([]);
  });
});
