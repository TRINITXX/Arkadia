import { describe, expect, it } from "vitest";
import { thoughtTitle } from "@/lib/chat/chatThoughts";

describe("a thinking summary's line", () => {
  it("is its bold title, else its first line, never more", () => {
    expect(thoughtTitle("**Lire avant d'écrire**\n\nJe lis note.txt.")).toBe(
      "Lire avant d'écrire",
    );
    expect(thoughtTitle("Je lis note.txt d'abord.\nPuis le résumé.")).toBe(
      "Je lis note.txt d'abord.",
    );
    expect(thoughtTitle("")).toBe("");
    expect(thoughtTitle("x".repeat(200))).toHaveLength(90);
  });
});
