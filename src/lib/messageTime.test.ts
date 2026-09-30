import { describe, it, expect } from "vitest";
import { messageTime, messageTimeFull } from "@/lib/messageTime";

describe("messageTime", () => {
  it("renders the local hour and minute, zero-padded", () => {
    const iso = "2026-09-30T21:27:10.376Z";
    const d = new Date(iso);
    const expected = `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
    expect(messageTime(iso)).toBe(expected);
    expect(messageTime(iso)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns null for a missing or unparsable stamp", () => {
    expect(messageTime(undefined)).toBeNull();
    expect(messageTime(null)).toBeNull();
    expect(messageTime("")).toBeNull();
    expect(messageTime("pas une date")).toBeNull();
  });
});

describe("messageTimeFull", () => {
  it("spells out the day, month and year with seconds", () => {
    expect(messageTimeFull("2026-09-30T21:27:10.376Z")).toMatch(
      /^\d{1,2} \S+ 2026 à \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("returns null for an unparsable stamp", () => {
    expect(messageTimeFull("nope")).toBeNull();
  });
});
