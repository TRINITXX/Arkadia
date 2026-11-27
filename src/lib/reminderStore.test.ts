import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  dismissReminder,
  launchReminder,
  launchReminders,
  postponeReminder,
  publishReminders,
  refreshReminders,
  reminderView,
} from "@/lib/reminderStore";
import type { Reminder } from "@/lib/reminders";

const calls: string[] = [];
/** Each command's answer; `reminders_list` may wait for `answerList`. */
let replies: Record<string, () => Promise<unknown>>;
let answerList: (list: Reminder[]) => void;

const due: Reminder = {
  id: "r1",
  conversation: "Arkadia",
  subject: "Rappel : lire la sonde",
  prompt: "Lis la sonde.",
  at: new Date(Date.now() - 60_000).toISOString(),
};

beforeEach(() => {
  calls.length = 0;
  replies = {};
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    calls.push(cmd);
    if (cmd === "reminders_list")
      return new Promise((resolve) => (answerList = resolve));
    return (replies[cmd] ?? (() => Promise.resolve()))() as Promise<never>;
  });
  publishReminders([due]);
});

const ids = () => reminderView().due.map((r) => r.id);

describe("reminderStore", () => {
  it("drops a folder read started before « Demain »", async () => {
    const read = refreshReminders();
    await postponeReminder(due);
    answerList([due]);
    await read;
    expect(ids()).toEqual([]);
  });

  it("« × » takes the reminder out of the list without a chat, even past a read started before", async () => {
    const read = refreshReminders();
    await dismissReminder(due);
    answerList([due]);
    await read;
    expect(calls).toEqual(["reminders_list", "reminder_claim"]);
    expect(ids()).toEqual([]);
  });

  it("« × » keeps the reminder out when a read starts during its claim", async () => {
    let finishClaim = () => {};
    replies.reminder_claim = () =>
      new Promise<void>((resolve) => (finishClaim = resolve));
    const dismiss = dismissReminder(due);
    const read = refreshReminders();
    answerList([due]);
    await read;
    finishClaim();
    await dismiss;
    expect(ids()).toEqual([]);
  });

  it("opens nothing when another took the reminder first", async () => {
    replies.reminder_claim = () => Promise.reject(new Error("déjà pris"));
    const open = vi.fn(() => Promise.resolve(true));
    const launch = launchReminder(due, open);
    await vi.waitFor(() => expect(calls).toContain("reminders_list"));
    answerList([]);
    await launch;
    expect(open).not.toHaveBeenCalled();
    expect(ids()).toEqual([]);
  });

  it("« Tout lancer » opens one chat after the other, skipping a reminder without project", async () => {
    const other: Reminder = { ...due, id: "r2" };
    const lost: Reminder = { ...due, id: "r3" };
    publishReminders([due, lost, other]);
    const opened: string[] = [];
    let finishFirst = () => {};
    const run = launchReminders([due, lost, other], (reminder) =>
      reminder.id === "r3"
        ? null
        : () => {
            opened.push(reminder.id);
            if (reminder.id !== "r1") return Promise.resolve(true);
            return new Promise<boolean>((resolve) => {
              finishFirst = () => resolve(true);
            });
          },
    );
    await vi.waitFor(() => expect(opened).toEqual(["r1"]));
    // r2 waits for r1's chat to be open.
    expect(calls.filter((c) => c === "reminder_claim")).toHaveLength(1);
    finishFirst();
    await run;
    expect(opened).toEqual(["r1", "r2"]);
    expect(ids()).toEqual(["r3"]);
  });

  it("« Tout lancer » leaves alone a reminder put off while the others open", async () => {
    const later: Reminder = { ...due, id: "r2" };
    publishReminders([due, later]);
    let finishFirst = () => {};
    const opened: string[] = [];
    const run = launchReminders([due, later], (reminder) => () => {
      opened.push(reminder.id);
      return new Promise<boolean>((resolve) => {
        finishFirst = () => resolve(true);
      });
    });
    await vi.waitFor(() => expect(opened).toEqual(["r1"]));
    await postponeReminder(later);
    finishFirst();
    await run;
    expect(opened).toEqual(["r1"]);
    expect(calls.filter((c) => c === "reminder_claim")).toHaveLength(1);
  });

  it("claims before opening, and gives back a chat that could not open", async () => {
    const launch = launchReminder(due, () => {
      calls.push("open");
      return Promise.resolve(false);
    });
    await vi.waitFor(() => expect(calls).toContain("reminders_list"));
    answerList([due]);
    await launch;
    expect(calls).toEqual([
      "reminder_claim",
      "open",
      "reminder_unclaim",
      "reminders_list",
    ]);
    expect(ids()).toEqual(["r1"]);
  });
});
