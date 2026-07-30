import { describe, it, expect } from "vitest";
import { quotePathsForPrompt } from "./photoPrompt";

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
