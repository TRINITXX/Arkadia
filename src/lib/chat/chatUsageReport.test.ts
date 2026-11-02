import { describe, expect, it } from "vitest";
import { usageOfLimits } from "@/lib/chat/chatUsageReport";

describe("usageOfLimits", () => {
  it("gives the chat's windows in percent, as the accounts store them", () => {
    expect(
      usageOfLimits({ fiveHour: { utilization: 1, resetsAt: 1_793_586_000 } }),
    ).toEqual({
      fiveHour: { pct: 100, resetsAt: 1_793_586_000 },
      sevenDay: null,
    });
  });

  it("reports nothing before any window is known", () => {
    expect(usageOfLimits({})).toBeNull();
  });
});
