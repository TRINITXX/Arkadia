import { describe, expect, it } from "vitest";
import {
  AT_REST,
  cronCount,
  queuedAfter,
  readSleepAfter,
  sleepDue,
  tasksAfter,
  turnAfter,
} from "../../../chat-server/sleep.ts";

const MIN = 60_000;

describe("when a chat's Claude Code goes to sleep (chat-server/sleep.ts)", () => {
  it("sleeps once nothing was done in it for the delay", () => {
    expect(sleepDue(AT_REST, 0, 29 * MIN, 30 * MIN)).toBe(false);
    expect(sleepDue(AT_REST, 0, 30 * MIN, 30 * MIN)).toBe(true);
    // « Jamais » in the Lab's setting.
    expect(sleepDue(AT_REST, 0, 999 * MIN, null)).toBe(false);
  });

  it("never sleeps while anything runs or waits, however long", () => {
    const blockers = [
      { turn: true },
      { tasks: 1 },
      { requests: 1 },
      { queued: 1 },
      { bangs: 1 },
      { crons: 1 },
    ];
    for (const b of blockers) {
      expect(sleepDue({ ...AT_REST, ...b }, 0, 999 * MIN, 30 * MIN)).toBe(
        false,
      );
    }
  });

  it("follows a turn from its first reply to its result, not a subagent's", () => {
    let turn = turnAfter(false, { type: "stream_event" });
    expect(turn).toBe(true);
    turn = turnAfter(turn, { type: "result", parent_tool_use_id: "agent" });
    expect(turn).toBe(true);
    expect(turnAfter(turn, { type: "result" })).toBe(false);
  });

  it("counts background tasks, ambient ones aside, until their end", () => {
    let tasks = tasksAfter([], {
      type: "system",
      subtype: "task_started",
      task_id: "a",
    });
    tasks = tasksAfter(tasks, {
      type: "system",
      subtype: "task_started",
      task_id: "h",
      ambient: true,
    });
    expect(tasks).toEqual(["a"]);
    tasks = tasksAfter(tasks, {
      type: "system",
      subtype: "task_updated",
      task_id: "a",
      patch: { status: "killed" },
    });
    expect(tasks).toEqual([]);
  });

  it("takes the live set whole from background_tasks_changed", () => {
    const tasks = tasksAfter(["gone"], {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "b" }, { task_id: "c", ambient: true }],
    });
    expect(tasks).toEqual(["b"]);
  });

  it("lets a message go once Claude Code takes or drops it", () => {
    const queued = ["u1", "u2"];
    expect(
      queuedAfter(queued, {
        type: "command_lifecycle",
        command_uuid: "u1",
        state: "queued",
      }),
    ).toEqual(queued);
    expect(
      queuedAfter(queued, {
        type: "command_lifecycle",
        command_uuid: "u1",
        state: "started",
      }),
    ).toEqual(["u2"]);
    expect(
      queuedAfter(queued, { type: "assistant", user_message_uuids: ["u2"] }),
    ).toEqual(["u1"]);
    expect(queuedAfter(queued, { type: "result" })).toEqual([]);
  });

  it("keeps a chat with a wakeup scheduled awake (Stop hook's session_crons)", () => {
    expect(cronCount({ session_crons: [{ id: "c1" }] })).toBe(1);
    expect(cronCount({})).toBe(0);
  });

  it("reads the Lab's setting as a command carries it", () => {
    expect(readSleepAfter(15 * MIN)).toBe(15 * MIN);
    expect(readSleepAfter(null)).toBeNull();
    expect(readSleepAfter(undefined)).toBeUndefined();
    expect(readSleepAfter(-1)).toBeUndefined();
  });
});
