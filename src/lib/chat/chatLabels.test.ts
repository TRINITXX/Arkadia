import { describe, expect, it } from "vitest";
import { resetLabel } from "@/lib/chat/chatLabels";

describe("resetLabel", () => {
  const now = 1_000_000_000_000;
  const at = (ms: number) => (now + ms) / 1000;

  it("counts down in whole minutes, as the terminal's Reset", () => {
    expect(resetLabel(at(135 * 60_000 + 59_000), now)).toBe("2 h 15 min");
    expect(resetLabel(at(180 * 60_000), now)).toBe("3 h");
    expect(resetLabel(at(45 * 60_000), now)).toBe("45 min");
    expect(resetLabel(at(30_000), now)).toBe("< 1 min");
  });

  it("shows nothing once the reset is past", () => {
    expect(resetLabel(at(0), now)).toBeNull();
    expect(resetLabel(at(-60_000), now)).toBeNull();
  });
});
