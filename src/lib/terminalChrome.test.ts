import { describe, expect, it } from "vitest";
import {
  inputRowIndex,
  isDictating,
  isPromptField,
  promptFieldText,
  trustAnswerKey,
  voiceFailure,
  voiceFailureText,
} from "@/lib/terminalChrome";
import type { CellRun, RenderPayload } from "@/types";

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

function screenOf(rows: string[]): RenderPayload {
  return {
    session_id: "p1",
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

describe("inputRowIndex", () => {
  it("finds the row of Claude Code's input box", () => {
    expect(
      inputRowIndex(
        screenOf([
          "● done",
          "╭──────────────╮",
          "❯ /rc",
          "╰──────────────╯",
          "  ⏵⏵ accept edits on",
        ]),
      ),
    ).toBe(2);
  });

  it("takes the bottom-most one, so a quoted `❯` in the transcript never wins", () => {
    expect(inputRowIndex(screenOf(["❯ my previous message", "", "❯ "]))).toBe(
      2,
    );
  });

  it("reports -1 with no prompt on screen (plain shell) and no frame at all", () => {
    expect(inputRowIndex(screenOf(["PS C:\\> ", "hello"]))).toBe(-1);
    expect(inputRowIndex(null)).toBe(-1);
  });
});

describe("isPromptField", () => {
  it("accepts the `❯` row under the box's top border, both border styles", () => {
    expect(
      isPromptField(screenOf(["● done", "────────", "❯ draft", "────────"])),
    ).toBe(true);
    expect(isPromptField(screenOf(["╭──────╮", "❯ /rc", "╰──────╯"]))).toBe(
      true,
    );
  });

  it("rejects an earlier message shown without the input box", () => {
    expect(
      isPromptField(screenOf(["● done", "", "❯ my previous message", ""])),
    ).toBe(false);
  });

  it("rejects a selector's highlighted choice, even inside a box", () => {
    expect(isPromptField(screenOf(["────────", "❯ 1. Yes", "  2. No"]))).toBe(
      false,
    );
  });
});

describe("trustAnswerKey", () => {
  /** The folder-trust question as seen through a PTY on v2.1.314. */
  const trust = (no: string, yes: string) =>
    screenOf([
      " Accessing workspace:",
      " C:\\Users\\TRINITX\\AppData\\Local\\Arkadia\\voice-lab",
      " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not,",
      " Security guide",
      no,
      yes,
      " Enter to confirm · Esc to cancel",
    ]).lines;

  it("moves off the default answer, which quits", () => {
    expect(
      trustAnswerKey(trust(" ❯ No, exit", "   Yes, I trust this folder")),
    ).toBe("down");
  });

  it("confirms once the yes is selected, numbered or not", () => {
    expect(
      trustAnswerKey(trust("   No, exit", " ❯ Yes, I trust this folder")),
    ).toBe("enter");
    expect(trustAnswerKey(trust("❯ 1. Yes, proceed", "  2. No, exit"))).toBe(
      "enter",
    );
  });

  it("ignores the same words left in the prompt field", () => {
    expect(
      trustAnswerKey(
        screenOf(["────────", "❯ 1. Yes, one you trust", "────────"]).lines,
      ),
    ).toBe(null);
  });

  it("leaves other lists to a person", () => {
    expect(
      trustAnswerKey(
        screenOf(["Select login method:", "❯ 1. Claude account", "  2. API"])
          .lines,
      ),
    ).toBe(null);
  });
});

describe("isDictating", () => {
  /** Rows as seen through a PTY on v2.1.310: the status sits right-aligned
   * above the box. */
  const box = (status: string, prompt = "❯ ▂", width = 80) =>
    screenOf([
      "● done",
      status.padStart(width),
      "────────",
      prompt,
      "────────",
      "  ⏵⏵ auto mode on",
    ]);

  it("sees warm-up, recording and transcribing above the input box", () => {
    expect(isDictating(box("keep holding…"))).toBe(true);
    expect(isDictating(box("listening…"))).toBe(true);
    expect(isDictating(box("Voice: processing…"))).toBe(true);
  });

  it("sees it in a pane too narrow to push it past the middle", () => {
    expect(isDictating(box("Voice: processing…", "❯ ▂", 24))).toBe(true);
  });

  it("is over once the effort badge or the outcome comes back", () => {
    expect(isDictating(box("◉ xhigh · /effort"))).toBe(false);
    expect(isDictating(box("No speech detected."))).toBe(false);
    expect(isDictating(null)).toBe(false);
  });

  it("reads a dictation that brought no text", () => {
    expect(voiceFailure(box("No speech detected."))).toBe(
      "No speech detected.",
    );
    expect(voiceFailure(box("No audio detected from microphone"))).toBe(
      "No audio detected from microphone",
    );
    expect(voiceFailure(box("◉ xhigh · /effort"))).toBeNull();
    expect(
      voiceFailure(box("", "❯ No speech detected in the logs")),
    ).toBeNull();
  });

  it("says a known failure in French, an unknown one as Claude Code wrote it", () => {
    expect(voiceFailureText("No speech detected.")).toBe(
      "Aucune parole détectée",
    );
    expect(voiceFailureText("No audio detected from microphone")).toBe(
      "Aucun son reçu du micro",
    );
    expect(voiceFailureText("Dictation error: socket closed.")).toBe(
      "Erreur de dictée : socket closed",
    );
    expect(voiceFailureText("Voice is off")).toBe("Claude Code : Voice is off");
  });

  it("ignores the same words in the transcript and in the prompt", () => {
    expect(
      isDictating(
        screenOf([
          "● listening… then processing…",
          "────────",
          "❯ ",
          "────────",
        ]),
      ),
    ).toBe(false);
    expect(isDictating(box("", "❯ still processing… the logs"))).toBe(false);
  });
});

describe("promptFieldText", () => {
  const rule = "─".repeat(40);
  /** The field's first row: `❯`, then runs, dim or not (v2.1.316). */
  const field = (parts: [string, boolean][], more: string[] = []) => {
    const screen = screenOf([
      "◉ xhigh · /effort",
      rule,
      "",
      ...more,
      rule,
      "  ⏸ plan mode on (shift+tab to cycle)",
    ]);
    screen.lines[2] = [
      run("❯\u00a0"),
      ...parts.map(([text, dim]) => ({ ...run(text), dim })),
    ];
    return screen;
  };

  it("reads an empty field, its dim example aside", () => {
    expect(promptFieldText(field([]))).toBe("");
    const example = field([['Try "fix typecheck errors"', true]]);
    expect(promptFieldText(example)).toBe("");
    expect(promptFieldText(example, { dim: true })).toBe("");
  });

  it("joins a long text wrapped under the `❯`", () => {
    expect(
      promptFieldText(
        field(
          [["alpha onececi est une longue phrase de cent", false]],
          ["  soixante colonnes"],
        ),
      ),
    ).toBe("alpha onececi est une longue phrase de cent soixante colonnes");
  });

  it("keeps a dictation's dim words only when asked, without the cursor bar", () => {
    const listening = field([
      ["refais la ", false],
      ["vue lecture", true],
      ["▃", false],
    ]);
    expect(promptFieldText(listening, { dim: true })).toBe(
      "refais la vue lecture",
    );
    expect(promptFieldText(listening)).toBe("refais la");
  });

  it("is null without the field: a shell, a selector", () => {
    expect(promptFieldText(screenOf(["PS C:\\> "]))).toBeNull();
    expect(promptFieldText(null)).toBeNull();
  });
});
