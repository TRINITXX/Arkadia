import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellRun, RenderPayload } from "@/types";
import { dropFrame, publishFrame } from "./frameStore";
import {
  DICTATION_SETTLE_MS,
  DICTATION_TIMEOUT_MS,
  waitForDictationEnd,
} from "./dictationEnd";

function run(text: string): CellRun {
  return {
    text,
    fg: { kind: "default" },
    bg: { kind: "default" },
    bold: false,
    italic: false,
    underline_style: 0,
    inverse: false,
  };
}

/**
 * Claude Code's input box with `status` right-aligned on the row above it, or
 * a redraw without the input line when `prompt` is false.
 */
function footer(status: string, prompt = true): RenderPayload {
  const rows = [
    status.padStart(80),
    "────────",
    prompt ? "❯ hello" : "",
    "────────",
  ];
  return {
    session_id: "p",
    cols: 80,
    rows: rows.length,
    cursor_row: 0,
    cursor_col: 0,
    cursor_visible: true,
    title: "",
    lines: rows.map((t) => [run(t)]),
    scroll_offset: 0,
    scroll_max: 0,
    mouse_protocol: 0,
    mouse_sgr: false,
    bracketed_paste: false,
  };
}

/** Whether the promise has settled, and to what, without awaiting it. */
function peek(p: Promise<boolean>): { value: boolean | undefined } {
  const out: { value: boolean | undefined } = { value: undefined };
  void p.then((v) => (out.value = v));
  return out;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  dropFrame("p");
});

describe("waitForDictationEnd", () => {
  it("waits through recording and transcribing, then settles", async () => {
    publishFrame(footer("listening…"));
    const done = peek(waitForDictationEnd("p"));
    await vi.advanceTimersByTimeAsync(2000);
    publishFrame(footer("Voice: processing…"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(done.value).toBeUndefined();

    publishFrame(footer("◉ xhigh · /effort"));
    await vi.advanceTimersByTimeAsync(DICTATION_SETTLE_MS - 1);
    expect(done.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(done.value).toBe(true);
  });

  it("restarts the settle when the voice status comes back", async () => {
    publishFrame(footer("listening…"));
    const done = peek(waitForDictationEnd("p"));
    publishFrame(footer("◉ xhigh · /effort"));
    await vi.advanceTimersByTimeAsync(DICTATION_SETTLE_MS - 1);
    publishFrame(footer("Voice: processing…"));
    await vi.advanceTimersByTimeAsync(DICTATION_SETTLE_MS);
    expect(done.value).toBeUndefined();
  });

  it("holds the settle off while the input line is gone", async () => {
    publishFrame(footer("listening…"));
    const done = peek(waitForDictationEnd("p"));
    publishFrame(footer("", false));
    await vi.advanceTimersByTimeAsync(DICTATION_SETTLE_MS * 3);
    expect(done.value).toBeUndefined();
    publishFrame(footer("◉ xhigh · /effort"));
    await vi.advanceTimersByTimeAsync(DICTATION_SETTLE_MS);
    expect(done.value).toBe(true);
  });

  it("gives up on a transcription that never ends", async () => {
    publishFrame(footer("Voice: processing…"));
    const done = peek(waitForDictationEnd("p"));
    await vi.advanceTimersByTimeAsync(DICTATION_TIMEOUT_MS);
    expect(done.value).toBe(false);
  });
});
