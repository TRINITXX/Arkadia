import { describe, expect, it } from "vitest";
import { statusFigures } from "@/lib/chat/chatStatus";

describe("statusFigures", () => {
  const now = 1_000_000_000_000;
  const at = (ms: number) => (now + ms) / 1000;

  it("turns a ring amber from 80 %", () => {
    const figures = statusFigures(
      {
        context: { percentage: 80 },
        limits: {
          fiveHour: { utilization: 0.79 },
          sevenDay: { utilization: 0.8 },
        },
      },
      now,
    );
    expect(figures.context).toEqual({ percent: 80, hot: true });
    expect(figures.fiveHour?.hot).toBe(false);
    expect(figures.sevenDay?.hot).toBe(true);
  });

  it("reads a window past its reset as empty, with no countdown", () => {
    const figures = statusFigures(
      {
        context: null,
        limits: { fiveHour: { utilization: 0.9, resetsAt: at(-60_000) } },
      },
      now,
    );
    expect(figures.fiveHour).toEqual({
      percent: 0,
      hot: false,
      resetsAt: undefined,
    });
    expect(figures.reset).toBeNull();
    expect(figures.context).toBeNull();
    expect(figures.sevenDay).toBeNull();
  });

  it("shortens the session's countdown once hours lead", () => {
    const reset = (ms: number) =>
      statusFigures(
        {
          context: null,
          limits: { fiveHour: { utilization: 0.2, resetsAt: at(ms) } },
        },
        now,
      ).reset;
    expect(reset(135 * 60_000)).toBe("2 h 15");
    expect(reset(180 * 60_000)).toBe("3 h");
    expect(reset(45 * 60_000)).toBe("45 min");
  });

  it("keeps the countdown in full words for its tooltip", () => {
    const figures = statusFigures(
      {
        context: null,
        limits: { fiveHour: { utilization: 0.2, resetsAt: at(135 * 60_000) } },
      },
      now,
    );
    expect(figures.resetFull).toBe("2 h 15 min");
  });
});
