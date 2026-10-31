import { describe, expect, it } from "vitest";
import { dayBreaks } from "@/lib/chat/chatDays";
import { dayLabel } from "@/lib/messageTime";

const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 10, 31, 15);

describe("chat day separators", () => {
  it("names today, yesterday, then the day itself", () => {
    expect(dayLabel(at(2026, 10, 31, 8), NOW)).toBe("Aujourd'hui");
    expect(dayLabel(at(2026, 10, 30, 23), NOW)).toBe("Hier");
    expect(dayLabel(at(2026, 10, 27), NOW)).toBe("mar. 27 oct.");
    expect(dayLabel(at(2025, 12, 29), NOW)).toBe("lun. 29 déc. 2025");
  });

  it("marks each new day, the first one unless it is today", () => {
    const today = [at(2026, 10, 31, 9), undefined, at(2026, 10, 31, 10)];
    expect(dayBreaks(today, NOW).size).toBe(0);
    const breaks = dayBreaks(
      [
        at(2026, 10, 30, 9),
        undefined,
        at(2026, 10, 30, 22),
        at(2026, 10, 31, 8),
      ],
      NOW,
    );
    expect([...breaks]).toEqual([
      [0, "Hier"],
      [3, "Aujourd'hui"],
    ]);
  });
});
