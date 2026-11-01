import { describe, expect, it } from "vitest";
import { quotaAlerts, resetClock } from "@/lib/chat/chatQuota";

const NOW = new Date(2026, 9, 31, 18, 0).getTime();
const at = (day: number, h: number) =>
  Math.round(new Date(2026, 9, day, h, 0).getTime() / 1000);

describe("quotaAlerts", () => {
  it("says nothing of a window past its threshold or used up", () => {
    expect(
      quotaAlerts({
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
      }),
    ).toEqual([]);
    expect(
      quotaAlerts({
        status: "rejected",
        rateLimitType: "seven_day",
        resetsAt: at(33, 9),
      }),
    ).toEqual([]);
  });

  it("says extra usage once it is billed", () => {
    // An ordinary event (recorded fixture): overage refused by the org.
    expect(
      quotaAlerts({
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
      }),
    ).toEqual([]);
    expect(
      quotaAlerts({ status: "allowed", isUsingOverage: true })[0].text,
    ).toMatch(/^Usage payant activé/);
  });

  it("words a reset today, tomorrow or another day", () => {
    expect(resetClock(at(31, 21), NOW)).toBe("à 21:00");
    expect(resetClock(at(32, 3), NOW)).toBe("demain à 03:00");
  });
});
