import { describe, expect, it } from "vitest";
import { dayLabel, groupByDayThenProject } from "./sessionsByDay";
import type { ListedSession } from "./sessionsIndex";

const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 10, 25, 23);

const session = (id: string, cwd: string, mtime: number): ListedSession => ({
  id,
  path: `${id}.jsonl`,
  cwd,
  title: id,
  from_prompt: false,
  mtime,
});

describe("groupByDayThenProject", () => {
  it("sections by day, newest first, then by project folder", () => {
    const days = groupByDayThenProject(
      [
        session("a", "C:\\Desktop\\Arkadia", at(2026, 10, 25, 9)),
        session("b", "C:\\Desktop\\VTC-Planner-Mobile", at(2026, 10, 25, 22)),
        session("c", "C:\\Desktop\\Arkadia", at(2026, 10, 25, 21)),
        session("d", "C:\\Desktop\\Arkadia", at(2026, 10, 24, 10)),
      ],
      NOW,
    );
    expect(days.map((d) => d.label)).toEqual(["Aujourd'hui", "Hier"]);
    expect(days.map((d) => d.date)).toEqual([
      "dimanche 25 oct.",
      "samedi 24 oct.",
    ]);
    expect(days[0].projects.map((p) => p.name)).toEqual([
      "VTC-Planner-Mobile",
      "Arkadia",
    ]);
    expect(days[0].projects[1].sessions.map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("names older days with their weekday, and the year when it differs", () => {
    expect(dayLabel(at(2026, 10, 23, 0), NOW)).toBe("vendredi 23 oct.");
    expect(dayLabel(new Date(2025, 11, 31).getTime(), NOW)).toBe(
      "mercredi 31 déc. 2025",
    );
  });
});
