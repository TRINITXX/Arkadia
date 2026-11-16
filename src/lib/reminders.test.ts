import { describe, expect, it } from "vitest";
import {
  dueReminders,
  readReminders,
  reminderProject,
  remindersHeader,
  reminderSubtitle,
  reminderTitle,
  tomorrowAtNine,
  type Reminder,
} from "@/lib/reminders";

/** Local time, whatever the machine's zone. */
const local = (month: number, day: number, h: number, min = 0) =>
  new Date(2026, month - 1, day, h, min);

const reminder = (id: string, at: Date, subject = id): Reminder => ({
  id,
  conversation: "Arkadia",
  subject,
  prompt: "…",
  at: at.toISOString(),
});

describe("dueReminders", () => {
  it("keeps those due, the oldest first", () => {
    const now = local(11, 16, 10).getTime();
    const list = [
      reminder("later", local(11, 17, 9)),
      reminder("today", local(11, 16, 9)),
      reminder("now", local(11, 16, 10)),
      reminder("yesterday", local(11, 15, 9)),
    ];
    expect(dueReminders(list, now).map((r) => r.id)).toEqual([
      "yesterday",
      "today",
      "now",
    ]);
  });
});

describe("readReminders", () => {
  it("leaves out malformed entries", () => {
    const ok = reminder("ok", local(11, 16, 9));
    expect(readReminders([ok, { id: "x" }, null, "y"])).toEqual([ok]);
    expect(readReminders(null)).toEqual([]);
  });
});

describe("tomorrowAtNine", () => {
  it("is tomorrow 9:00 local time, across a month's end", () => {
    const at = new Date(tomorrowAtNine(local(11, 30, 23, 45)));
    expect([
      at.getMonth() + 1,
      at.getDate(),
      at.getHours(),
      at.getMinutes(),
    ]).toEqual([12, 1, 9, 0]);
  });
});

describe("reminderTitle", () => {
  it("drops the leading « Rappel : », its first letter up", () => {
    expect(reminderTitle("Rappel : lire la sonde")).toBe("Lire la sonde");
    expect(reminderTitle("rappel: lire la sonde")).toBe("Lire la sonde");
    expect(reminderTitle("Lire la sonde")).toBe("Lire la sonde");
  });
});

describe("reminderSubtitle", () => {
  const now = local(11, 16, 14);

  it("gives the hour alone when due today", () => {
    expect(reminderSubtitle(reminder("a", local(11, 16, 9)), now)).toBe(
      "Arkadia · prévu à 9 h",
    );
    expect(reminderSubtitle(reminder("a", local(11, 16, 9, 5)), now)).toBe(
      "Arkadia · prévu à 9 h 05",
    );
  });

  it("gives the day too on another day", () => {
    expect(reminderSubtitle(reminder("a", local(11, 15, 9)), now)).toBe(
      "Arkadia · prévu le 15/11 à 9 h",
    );
  });
});

describe("remindersHeader", () => {
  it("counts in French", () => {
    expect(remindersHeader(1)).toBe("1 rappel à lancer");
    expect(remindersHeader(3)).toBe("3 rappels à lancer");
  });
});

describe("reminderProject", () => {
  const projects = [
    { id: "1", name: "Énergie Plus", path: "C:\\work\\energie" },
    { id: "2", name: "VTC", path: "C:\\work\\VTC-Planner-Website" },
    { id: "3", name: "Claude Desktop", path: "C:\\Users\\me\\Claude Desktop" },
  ];

  it("matches a project's name, case and accents aside", () => {
    expect(reminderProject(projects, "energie plus")).toEqual({
      project: projects[0],
      fallback: false,
    });
  });

  it("else a project's folder name", () => {
    expect(reminderProject(projects, "vtc-planner-website")?.project).toBe(
      projects[1],
    );
  });

  it("else « Claude Desktop », else nothing", () => {
    expect(reminderProject(projects, "GTA 6")).toEqual({
      project: projects[2],
      fallback: true,
    });
    expect(reminderProject(projects.slice(0, 2), "GTA 6")).toBeNull();
  });
});
