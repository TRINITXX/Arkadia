import { describe, expect, it } from "vitest";
import { ghostSuggestion } from "@/lib/chat/useChatSuggestion";

describe("ghostSuggestion", () => {
  it("shows only in the empty input of an idle Claude, until something is typed over it", () => {
    const s = "Écris le script complet";
    expect(ghostSuggestion(s, "", false, null, false)).toBe(s);
    expect(ghostSuggestion(s, "É", false, null, false)).toBeNull();
    expect(ghostSuggestion(s, "", true, null, false)).toBeNull();
    // Typed over, then emptied: it stays away.
    expect(ghostSuggestion(s, "", false, s, false)).toBeNull();
    // A newer suggestion shows again.
    expect(ghostSuggestion("Lance les tests", "", false, s, false)).toBe(
      "Lance les tests",
    );
  });

  it("shows nothing while Claude is away (asleep, or the chat ended)", () => {
    expect(
      ghostSuggestion("Lance les tests", "", false, null, true),
    ).toBeNull();
  });
});
