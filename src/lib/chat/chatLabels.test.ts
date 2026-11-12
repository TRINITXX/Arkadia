import { describe, expect, it } from "vitest";
import {
  fastModeLabel,
  fastModeLine,
  modelLabel,
  resetLabel,
  tokensLabel,
} from "@/lib/chat/chatLabels";

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

describe("tokensLabel", () => {
  it("writes a million as M, never 1000 k", () => {
    expect(tokensLabel(940)).toBe("940");
    expect(tokensLabel(12_345)).toBe("12,3 k");
    expect(tokensLabel(999_960)).toBe("1 M");
    expect(tokensLabel(1_006_800)).toBe("1 M");
    expect(tokensLabel(1_250_000)).toBe("1,3 M");
  });
});

describe("fastModeLabel", () => {
  it("says fast mode on or paused, nothing while it is off", () => {
    expect(fastModeLabel("on")).toBe("↯ rapide");
    expect(fastModeLabel("cooldown")).toBe("↯ en pause");
    expect(fastModeLabel(null)).toBeNull();
    expect(fastModeLine("cooldown")).toBe(
      "↯ Mode rapide en pause après une limite d'usage",
    );
    expect(fastModeLine(null)).toBeNull();
  });
});

describe("modelLabel", () => {
  it("names a model picked by its alias as by its id", () => {
    expect(modelLabel("fable")).toBe("Fable 5.2");
    expect(modelLabel("claude-fable-5-2")).toBe("Fable 5.2");
    expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5");
  });
});
