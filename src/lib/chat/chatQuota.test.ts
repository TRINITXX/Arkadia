import { describe, expect, it } from "vitest";
import { quotaAlerts, resetClock } from "@/lib/chat/chatQuota";

const NOW = new Date(2026, 9, 31, 18, 0).getTime();
const at = (day: number, h: number) =>
  Math.round(new Date(2026, 9, day, h, 0).getTime() / 1000);

describe("quotaAlerts", () => {
  it("says a window past its warning threshold, and a used-up one with its reset", () => {
    const warned = quotaAlerts(
      {
        status: "allowed_warning",
        rateLimitType: "five_hour",
        unifiedWindows: {
          five_hour: {
            utilization: 0.91,
            resetsAt: at(31, 21),
            status: "allowed_warning",
            surpassedThreshold: 0.9,
          },
        },
      },
      NOW,
    );
    expect(warned).toEqual([
      {
        key: `five_hour:90:${at(31, 21)}`,
        text: "90 % de la session utilisés, reset à 21:00",
        tone: "warning",
      },
    ]);
    const rejected = quotaAlerts(
      { status: "rejected", rateLimitType: "seven_day", resetsAt: at(33, 9) },
      NOW,
    );
    expect(rejected[0].text).toBe(
      "Limite de la semaine atteinte, reset lundi à 09:00",
    );
    expect(rejected[0].tone).toBe("error");
  });

  it("stays quiet under the threshold, and says extra usage once it is billed", () => {
    // An ordinary event (recorded fixture): overage refused by the org.
    expect(
      quotaAlerts(
        {
          status: "allowed",
          rateLimitType: "five_hour",
          overageStatus: "rejected",
          isUsingOverage: false,
          unifiedWindows: {
            five_hour: {
              utilization: 0.37,
              resetsAt: at(31, 21),
              status: "allowed",
            },
          },
        },
        NOW,
      ),
    ).toEqual([]);
    expect(
      quotaAlerts({ status: "allowed", isUsingOverage: true }, NOW)[0].text,
    ).toMatch(/^Usage payant activé/);
  });

  it("words a reset today, tomorrow or another day", () => {
    expect(resetClock(at(31, 21), NOW)).toBe("à 21:00");
    expect(resetClock(at(32, 3), NOW)).toBe("demain à 03:00");
  });
});
