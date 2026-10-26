import { describe, expect, it } from "vitest";
import {
  decay,
  FLING_STOP_SPEED,
  releaseSpeed,
  smoothSpeed,
  takeSteps,
  wheelGap,
} from "./touchScroll";

describe("touchScroll", () => {
  it("keeps the part of a step not travelled yet", () => {
    expect(takeSteps(50, 15)).toEqual({ steps: 3, rest: 5 });
    expect(takeSteps(-20, 15)).toEqual({ steps: -1, rest: -5 });
    expect(takeSteps(10, 15)).toEqual({ steps: 0, rest: 10 });
  });

  it("follows the finger's speed, smoothed", () => {
    const speed = smoothSpeed(0, 30, 10);
    expect(speed).toBeGreaterThan(1);
    expect(speed).toBeLessThan(3);
    expect(smoothSpeed(2, 10, 0)).toBe(2);
  });

  it("hands no speed to the fling when the finger rested before lifting", () => {
    expect(releaseSpeed(1.5, 10)).toBe(1.5);
    expect(releaseSpeed(1.5, 500)).toBe(0);
  });

  it("slows a flick down to a stop within about two seconds", () => {
    let speed = 3;
    let ms = 0;
    while (Math.abs(speed) > FLING_STOP_SPEED) {
      speed = decay(speed, 16);
      ms += 16;
    }
    expect(ms).toBeGreaterThan(800);
    expect(ms).toBeLessThan(2500);
  });

  it("spaces wheel notches for a slow finger, not for a flick", () => {
    expect(wheelGap(0.3)).toBeGreaterThan(wheelGap(2));
    expect(wheelGap(-2)).toBe(wheelGap(2));
  });
});
