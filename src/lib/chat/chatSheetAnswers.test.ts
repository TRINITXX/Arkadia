import { describe, expect, it } from "vitest";
import {
  foldNextSheet,
  openRoundSheet,
  pasteSheetImages,
  sheetReplyParts,
  updateSheet,
  type SheetAnswers,
} from "@/lib/chat/chatSheetAnswers";
import type { ChatItem } from "@/lib/chat/chatState";

const ROUND: ChatItem[] = [
  {
    kind: "text",
    id: "r1",
    text: "❓ **Q1** - **Heure** : laquelle ?\na) 9 h\nb) 18 h\n\n➡️ a) 9 h",
  },
];

/** The sheet as kept for that reply. */
function sheetOf(paneId: string): SheetAnswers {
  let seen: SheetAnswers | null = null;
  updateSheet(paneId, "r1", (s) => (seen = s));
  return seen!;
}

describe("a click on the chat's notification", () => {
  it("unfolds the round's sheet", () => {
    updateSheet("p1", "r1", (s) => ({ ...s, folded: true }));
    openRoundSheet("p1", ROUND);
    expect(sheetOf("p1")).toMatchObject({ folded: false, closed: false });
  });

  it("never reopens a sheet the user closed", () => {
    updateSheet("p2", "r1", (s) => ({ ...s, closed: true }));
    openRoundSheet("p2", ROUND);
    expect(sheetOf("p2").closed).toBe(true);
  });
});

describe("a message brought back by its pencil", () => {
  it("opens the round the rewind shows again folded, the input seen", () => {
    foldNextSheet("p3");
    expect(sheetOf("p3").folded).toBe(true);
    // Once: the round after it opens unfolded again.
    let next: SheetAnswers | null = null;
    updateSheet("p3", "r2", (s) => (next = s));
    expect(next!.folded).toBeUndefined();
  });
});

describe("images pasted into the sheet", () => {
  const img = (id: string) => ({
    id,
    url: "data:,",
    mediaType: "image/png",
    data: "x",
  });
  it("numbers them across the round, their tags at the caret, sent with the reply", () => {
    updateSheet("p9", "r1", (s) => ({
      ...s,
      answers: { q1: { text: "voir [Image #3]" }, q2: { text: "Bleu" } },
    }));
    const caret = pasteSheetImages("p9", "r1", "q2", [img("a")], 4, 4);
    const { answers } = sheetOf("p9");
    expect(answers.q2.text).toBe("Bleu[Image #4]");
    expect(caret).toBe("Bleu[Image #4]".length);
    expect(answers.q2.images?.map((i) => i.n)).toEqual([4]);
    // A tag erased by hand comes back at its answer's end; an image alone answers.
    updateSheet("p9", "r1", (s) => ({
      ...s,
      answers: {
        q1: { option: "a", images: [{ ...img("b"), n: 1 }] },
        q2: { text: "Bleu", images: [{ ...img("a"), n: 4 }] },
      },
    }));
    const parts = sheetReplyParts(sheetOf("p9").answers);
    expect(parts.answers.q1.text).toBe("[Image #1]");
    expect(parts.answers.q2.text).toBe("Bleu [Image #4]");
    expect(parts.images.map((i) => i.n)).toEqual([1, 4]);
  });
});
