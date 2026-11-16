import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  launchReminder,
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
