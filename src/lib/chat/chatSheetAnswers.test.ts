import { describe, expect, it } from "vitest";
import {
  openRoundSheet,
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
