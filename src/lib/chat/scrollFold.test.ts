import { describe, expect, it } from "vitest";
import {
  createScrollFold,
  foldRoomLeft,
  followsInRoom,
  openingRoom,
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

describe("followsInRoom", () => {
  it("follows again only coming down onto the end, a still scroll changing nothing", () => {
    expect(followsInRoom(false, 600, 590, "end")).toBe(true);
    // One pixel up, the gap a pixel: no end.
    expect(followsInRoom(false, 549, 550, null)).toBe(false);
    expect(followsInRoom(true, 549, 550, null)).toBe(false);
    // The column's own pinning, the gap grown under a rising sheet.
    expect(followsInRoom(true, 1375, 1375, null)).toBe(true);
    expect(followsInRoom(false, 1375, 1375, null)).toBe(false);
  });
});

describe("openingRoom", () => {
  it("gives the room back as the dock grows, none once it stands", () => {
    // The sheet rises into 168 px of blank by 208 px: the text rides with it.
    expect(openingRoom(168, 0, 208)).toBe(168);
    expect(openingRoom(168, 104, 208)).toBe(84);
    expect(openingRoom(168, 208, 208)).toBe(0);
    // It took back 277 px of questions and adds 197: the text glides down.
    expect(openingRoom(277, 98, 197)).toBe(139);
    expect(openingRoom(277, 230, 197)).toBe(0);
    // Its growth unknown (no motion): no room, the end shows at once.
    expect(openingRoom(277, 0, 0)).toBe(0);
  });
});

describe("the opening window", () => {
  it("lasts the sheet's motion, a new one starting afresh", () => {
    let t = 1000;
    const column = createScrollFold(() => t);
    let heard = 0;
    column.setOnOpening(() => heard++);
    expect(column.isOpening()).toBe(false);
    column.setOpeningGrowth(200);
    column.opening();
    expect(heard).toBe(1);
    expect(column.isOpening()).toBe(true);
    // Its growth is the next sheet's to say.
    expect(column.openingGrowth()).toBe(0);
    t += 1000;
    expect(column.isOpening()).toBe(false);
    // Said as the sheet's motion starts, the window runs from there.
    column.setOpeningGrowth(150);
    expect(column.isOpening()).toBe(true);
    expect(column.openingGrowth()).toBe(150);
  });

  it("keeps the dock's last height for a sheet shown after the pane", () => {
    const column = createScrollFold();
    expect(column.dockHeight()).toBeNull();
    column.setDockHeight(183);
    expect(column.dockHeight()).toBe(183);
  });
});
