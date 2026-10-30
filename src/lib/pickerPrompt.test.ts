import { describe, it, expect } from "vitest";
import { insertPathsInDraft, quotePathsForPrompt } from "./pickerPrompt";

const ROLL = "C:\\Users\\T\\Pictures\\iCloud Photos\\Photos";

describe("quotePathsForPrompt", () => {
  it("quotes a single path and leaves room to keep typing", () => {
    expect(quotePathsForPrompt([`${ROLL}\\IMG_7144.PNG`])).toBe(
      `"${ROLL}\\IMG_7144.PNG" `,
    );
  });

  it("separates several paths with a space, each quoted", () => {
    expect(
      quotePathsForPrompt([`${ROLL}\\IMG_7144.PNG`, `${ROLL}\\IMG_7143.PNG`]),
    ).toBe(`"${ROLL}\\IMG_7144.PNG" "${ROLL}\\IMG_7143.PNG" `);
  });

  it("keeps the blank in `iCloud Photos` inside one argument", () => {
    const out = quotePathsForPrompt([`${ROLL}\\a.png`]);
    // Quotes must bracket the whole path, blank included — that's the point.
    expect(out.trimEnd()).toMatch(/^"[^"]*iCloud Photos[^"]*"$/);
  });

  it("emits nothing for an empty selection", () => {
    expect(quotePathsForPrompt([])).toBe("");
  });

  it("never appends a newline (the caller must not submit)", () => {
    expect(quotePathsForPrompt([`${ROLL}\\a.png`])).not.toMatch(/[\r\n]/);
  });
});

describe("insertPathsInDraft", () => {
  it("lands at the caret, after a space, and at the end without a caret", () => {
    const shot = `${ROLL}\\IMG_7144.PNG`;
    expect(
      insertPathsInDraft("vois et dis", [shot], { start: 5, end: 5 }),
    ).toEqual({
      text: `vois "${shot}" et dis`,
      caret: `vois "${shot}" `.length,
    });
    expect(insertPathsInDraft("regarde", [shot], null)).toEqual({
      text: `regarde "${shot}" `,
      caret: `regarde "${shot}" `.length,
    });
    expect(insertPathsInDraft("", [shot], { start: 0, end: 0 }).text).toBe(
      `"${shot}" `,
    );
  });

  it("works on the draft as it is at insert time, not when the picker opened", () => {
    const shot = `${ROLL}\\IMG_7144.PNG`;
    // Opened on "Bonjour regarde" with the caret at 9, then « Effacer » and
    // "Bonjour" typed: a stale caret lands past the end, never mid-word.
    expect(
      insertPathsInDraft("Bonjour", [shot], { start: 9, end: 9 }).text,
    ).toBe(`Bonjour "${shot}" `);
    // A dictation landed meanwhile: React put the caret after it.
    const dictated = "Regarde ces captures";
    expect(
      insertPathsInDraft(dictated, [shot], {
        start: dictated.length,
        end: dictated.length,
      }).text,
    ).toBe(`Regarde ces captures "${shot}" `);
  });
});
