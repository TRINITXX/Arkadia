import { describe, expect, it } from "vitest";
import {
  createScrollFold,
  foldRoomLeft,
  scrollFoldEvent,
  scrollFoldStep,
  wheelAtEnd,
} from "@/lib/chat/scrollFold";

describe("scrollFoldEvent", () => {
  it("hears the reader going up, or coming down onto the end", () => {
    expect(scrollFoldEvent(900, 940, 60)).toBe("up");
    expect(scrollFoldEvent(940, 900, 1)).toBe("end");
    expect(scrollFoldEvent(920, 900, 40)).toBeNull();
    // Content shrinking clamps the view onto the end, upwards: no event.
    expect(scrollFoldEvent(880, 940, 0)).toBeNull();
  });

  it("asks the end on a wheel down there, where no scroll comes", () => {
    expect(wheelAtEnd(100, 0)).toBe(true);
    expect(wheelAtEnd(-100, 0)).toBe(false);
    expect(wheelAtEnd(100, 30)).toBe(false);
  });
});

describe("scrollFoldStep", () => {
  const open = { open: true, folded: false, auto: false };
  it("folds on the way up, unfolds at the end only what the scroll folded", () => {
    expect(scrollFoldStep(open, "up")).toEqual({ folded: true, auto: true });
    expect(
      scrollFoldStep({ ...open, folded: true, auto: true }, "end"),
    ).toEqual({ folded: false, auto: false });
    // Folded by hand: the end leaves it so.
    expect(scrollFoldStep({ ...open, folded: true }, "end")).toBeNull();
    expect(scrollFoldStep({ ...open, open: false }, "up")).toBeNull();
    expect(scrollFoldStep(open, "end")).toBeNull();
  });

  it("makes a scroll's fold the user's once the input it showed is used", () => {
    const auto = { open: true, folded: true, auto: true };
    expect(scrollFoldStep(auto, "keep")).toEqual({ folded: true, auto: false });
    expect(scrollFoldStep({ ...auto, auto: false }, "end")).toBeNull();
    // Its dictation under way (not open): it neither folds nor unfolds.
    const held = { open: false, folded: false, auto: false };
    expect(scrollFoldStep(held, "up")).toBeNull();
  });

  it("says when a sheet moved, for the room under the column", () => {
    const column = createScrollFold();
    expect(column.emit("up")).toBe(false);
    const off = column.subscribe((e) => e === "up");
    expect(column.emit("up")).toBe(true);
    off();
    expect(column.emit("up")).toBe(false);
  });
});

describe("foldRoomLeft", () => {
  // 1000 px of conversation, a view of 400: its end at scrollTop 600.
  it("keeps the view still as the sheet frees height, then shrinks out of view", () => {
    // 50 px above the end, the view grows by 300 (room 320 put first).
    expect(foldRoomLeft(320, 550, 700, 1320)).toBe(250);
    // The reader goes on up: the room under the view goes.
    expect(foldRoomLeft(250, 450, 700, 1250)).toBe(150);
    expect(foldRoomLeft(150, 200, 700, 1150)).toBe(0);
  });

  it("leaves the column at its scroll end, where a step up is still no end", () => {
    const room = foldRoomLeft(320, 550, 700, 1320);
    const height = 1000 + room;
    expect(height - 550 - 700).toBe(0);
    // One pixel up (a touchpad, the wheel's last frames): a gap of 1, no end.
    expect(scrollFoldEvent(549, 550, height - 549 - 700)).toBeNull();
  });

  it("never grows: the reader coming back down meets the room's end", () => {
    expect(foldRoomLeft(100, 450, 700, 1100)).toBe(100);
    expect(foldRoomLeft(0, 300, 700, 1000)).toBe(0);
  });
});
