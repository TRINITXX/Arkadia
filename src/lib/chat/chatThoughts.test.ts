import { describe, expect, it } from "vitest";
import { thoughtBody } from "@/lib/chat/chatThoughts";

describe("a thinking summary as shown", () => {
  it("is its text without its heading", () => {
    expect(
      thoughtBody(
        "**Lire avant d'écrire**\n\nJe lis note.txt.\n\nPuis le résumé.",
      ),
    ).toBe("Je lis note.txt.\nPuis le résumé.");
    expect(thoughtBody("Je lis note.txt d'abord.")).toBe(
      "Je lis note.txt d'abord.",
    );
    // A heading alone: kept, plain.
    expect(thoughtBody("**Lire avant d'écrire**")).toBe("Lire avant d'écrire");
    expect(thoughtBody("")).toBe("");
  });
});
