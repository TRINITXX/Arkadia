import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { publishFrame } from "@/lib/frameStore";
import { clearPromptChunks } from "@/lib/promptClear";
import {
  emptyAfterCapture,
  hookReportsFailure,
  waitForPrompt,
} from "@/lib/useHiddenVoice";
import type { CellRun, RenderPayload } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

const PANE = "voice";
const DOWN = [0x1b, 0x5b, 0x42];
const ENTER = [0x0d];

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

function show(rows: string[]): void {
  const frame: RenderPayload = {
    session_id: PANE,
    cols: 160,
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
  publishFrame(frame);
}

/** The folder-trust question as seen through a PTY on v2.1.314. */
const trust = (yes: boolean) =>
  show([
    " Quick safety check: Is this a project you created or one you trust?",
    " Security guide",
    yes ? "   No, exit" : " ❯ No, exit",
    yes ? " ❯ Yes, I trust this folder" : "   Yes, I trust this folder",
    " Enter to confirm · Esc to cancel",
  ]);

const keys = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "send_input")
    .map(([, args]) => (args as { bytes: number[] }).bytes);

describe("waitForPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("answers yes to the trust question, though no frame follows the last key", async () => {
    trust(false);
    const ready = waitForPrompt(PANE);
    // A key sent while the dialog still draws is undone: none goes yet.
    await vi.advanceTimersByTimeAsync(150);
    trust(false);
    expect(keys()).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(keys()).toEqual([DOWN]);
    // The arrow's redraw is the last frame until Enter.
    trust(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(keys()).toEqual([DOWN, ENTER]);
    show(["────────", "❯ ", "────────"]);
    await expect(ready).resolves.toBe(true);
  });

  it("never presses Enter while the cursor is on the default answer", async () => {
    trust(false);
    const ready = waitForPrompt(PANE);
    await vi.advanceTimersByTimeAsync(5000);
    expect(keys().some((k) => k[0] === ENTER[0])).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(ready).resolves.toBe(false);
  });
});

describe("emptyAfterCapture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  /** The field as seen through a PTY on v2.1.316. */
  const field = (text: string) =>
    show(["─".repeat(40), `❯ ${text}`, "─".repeat(40)]);

  it("empties the field Claude Code refills with the blocked dictation", async () => {
    // Submitted: the field is empty a beat, then the hook's block puts the
    // text back (« alpha one » came back before « beta two » in the probe).
    field("");
    const done = emptyAfterCapture(PANE);
    await vi.advanceTimersByTimeAsync(100);
    expect(keys()).toEqual([]);
    field("refais la vue lecture");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(keys()).toEqual(clearPromptChunks());
    field("");
    await done;
  });
});

describe("hookReportsFailure", () => {
  it("leaves a failure to the caller only while it is there to tell it", () => {
    let alive = true;
    const quiet = () => alive;
    expect(hookReportsFailure(null)).toBe(true);
    expect(hookReportsFailure(quiet)).toBe(false);
    // The input waiting to send went away (a question took its place).
    alive = false;
    expect(hookReportsFailure(quiet)).toBe(true);
  });
});
