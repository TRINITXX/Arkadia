import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderPayload } from "@/types";
import {
  displayedFrame,
  dropFrame,
  getFrame,
  publishFrame,
  rememberDesktopSize,
  sizeToReclaim,
  subscribeFrame,
} from "./frameStore";

function frame(id: string, title = ""): RenderPayload {
  return {
    session_id: id,
    cols: 80,
    rows: 24,
    cursor_row: 0,
    cursor_col: 0,
    cursor_visible: true,
    title,
    lines: [],
    scroll_offset: 0,
    scroll_max: 0,
    mouse_protocol: 0,
    mouse_sgr: false,
    bracketed_paste: false,
    line_kinds: [],
  };
}

afterEach(() => {
  dropFrame("a");
  dropFrame("b");
});

describe("frameStore", () => {
  it("stores the latest frame per pane", () => {
    expect(getFrame("a")).toBeNull();
    const f1 = frame("a", "one");
    publishFrame(f1);
    expect(getFrame("a")).toBe(f1);
    const f2 = frame("a", "two");
    publishFrame(f2);
    expect(getFrame("a")).toBe(f2);
  });

  it("notifies only the pane's own subscribers", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    subscribeFrame("a", onA);
    subscribeFrame("b", onB);
    publishFrame(frame("a"));
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });

  it("unsubscribe stops notifications", () => {
    const cb = vi.fn();
    const off = subscribeFrame("a", cb);
    publishFrame(frame("a"));
    off();
    publishFrame(frame("a"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("dropFrame forgets the frame and its subscribers", () => {
    const cb = vi.fn();
    subscribeFrame("a", cb);
    publishFrame(frame("a"));
    dropFrame("a");
    expect(getFrame("a")).toBeNull();
    publishFrame(frame("a"));
    // The old subscriber was dropped with the pane.
    expect(cb).toHaveBeenCalledTimes(1);
    dropFrame("a");
  });

  it("gives the desktop its size back once a phone resized the pane", () => {
    rememberDesktopSize("a", 80, 24);
    publishFrame(frame("a"));
    expect(sizeToReclaim("a")).toBeNull();
    publishFrame({ ...frame("a"), cols: 52, rows: 30 });
    expect(sizeToReclaim("a")).toEqual({ cols: 80, rows: 24 });
  });

  it("keeps a hidden pane on the frame it last displayed", () => {
    const held = { current: null };
    const f1 = frame("a", "one");
    publishFrame(f1);
    expect(displayedFrame(held, "a", true)).toBe(f1);
    publishFrame(frame("a", "two"));
    expect(displayedFrame(held, "a", false)).toBe(f1);
    const f3 = frame("a", "three");
    publishFrame(f3);
    expect(displayedFrame(held, "a", true)).toBe(f3);
  });

  it("serves a pane hidden from the start the frame it has", () => {
    const held = { current: null };
    const f1 = frame("b", "one");
    publishFrame(f1);
    expect(displayedFrame(held, "b", false)).toBe(f1);
    publishFrame(frame("b", "two"));
    expect(displayedFrame(held, "b", false)).toBe(f1);
  });
});
