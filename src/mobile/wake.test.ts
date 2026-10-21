import { describe, expect, it } from "vitest";
import { STEP_LATE_MS, isLate, wakeAfterLostGate } from "./wake";

describe("wakeAfterLostGate", () => {
  it("drops a finished wake once the PC goes away again", () => {
    expect(wakeAfterLostGate({ done: 3, since: 0, failed: false })).toBeNull();
  });

  it("keeps a wake under way, whose PC is not up yet", () => {
    const wake = { done: 1, since: 0, failed: false } as const;
    expect(wakeAfterLostGate(wake)).toBe(wake);
  });
});

describe("isLate", () => {
  it("gives the pending step 30 s", () => {
    const wake = { done: 1, since: 0, failed: false } as const;
    expect(isLate(wake, STEP_LATE_MS)).toBe(false);
    expect(isLate(wake, STEP_LATE_MS + 1)).toBe(true);
  });

  it("says so at once when the order never left", () => {
    expect(isLate({ done: 0, since: 0, failed: true }, 0)).toBe(true);
  });

  it("never once Windows answers", () => {
    expect(
      isLate({ done: 3, since: 0, failed: false }, 10 * STEP_LATE_MS),
    ).toBe(false);
  });
});
