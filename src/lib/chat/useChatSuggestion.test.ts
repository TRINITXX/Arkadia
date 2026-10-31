import { describe, expect, it } from "vitest";
import { ghostSuggestion } from "@/lib/chat/useChatSuggestion";

describe("ghostSuggestion", () => {
  it("shows only in the empty input of an idle Claude, until something is typed over it", () => {
    const s = "Écris le script complet";
    expect(ghostSuggestion(s, "", false, null)).toBe(s);
    expect(ghostSuggestion(s, "É", false, null)).toBeNull();
    expect(ghostSuggestion(s, "", true, null)).toBeNull();
    // Typed over, then emptied: it stays away.
    expect(ghostSuggestion(s, "", false, s)).toBeNull();
    // A newer suggestion shows again.
    expect(ghostSuggestion("Lance les tests", "", false, s)).toBe(
      "Lance les tests",
    );
  });
});
