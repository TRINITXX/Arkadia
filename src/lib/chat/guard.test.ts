import { describe, expect, it } from "vitest";
import {
  pipeGone,
  STRAY_LIMIT,
  STRAY_WINDOW_MS,
  strayVerdict,
} from "../../../chat-server/guard.ts";

describe("an error no chat caught (chat-server/guard.ts)", () => {
  it("ends nothing, until they pile up within a minute", () => {
    let times: number[] = [];
    for (let i = 0; i < STRAY_LIMIT; i++) {
      const verdict = strayVerdict(times, 1_000 + i);
      expect(verdict.exit).toBe(false);
      times = verdict.times;
    }
    expect(strayVerdict(times, 2_000).exit).toBe(true);
    // A minute later the old ones are forgotten.
    expect(strayVerdict(times, 1_000 + STRAY_WINDOW_MS + 100).exit).toBe(false);
  });

  it("knows Arkadia closed its pipe", () => {
    expect(pipeGone({ code: "EPIPE" })).toBe(true);
    expect(pipeGone(new Error("boom"))).toBe(false);
  });
});
