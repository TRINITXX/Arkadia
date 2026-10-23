import { describe, expect, it } from "vitest";
import { formatDuration } from "./videoPoster";

describe("formatDuration", () => {
  it("counts whole seconds like the player, hours only when there are some", () => {
    expect(formatDuration(13.8)).toBe("0:13");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});
