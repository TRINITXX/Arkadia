import { describe, expect, it } from "vitest";
import { splitTechDetail } from "@/lib/chat/chatTechDetail";

describe("a reply's « Détail technique » (chatTechDetail)", () => {
  it("is set apart after the last rule", () => {
    const reply =
      "✅ C'est corrigé.\n\n| Quoi | État |\n\n---\nDétail technique : `src/a.ts`, `src/b.ts`.";
    expect(splitTechDetail(reply)).toEqual({
      main: "✅ C'est corrigé.\n\n| Quoi | État |",
      tech: "Détail technique : `src/a.ts`, `src/b.ts`.",
    });
  });

  it("leaves a rule between two questions as it is", () => {
    const round = "❓ **Q1** - …\n\n➡️ Oui.\n\n---\n\n❓ **Q2** - …\n\n➡️ Oui.";
    expect(splitTechDetail(round)).toBeNull();
  });

  it("takes the last rule only, and never a reply that would be empty", () => {
    const reply = "Q1\n\n---\n\nQ2\n\n---\n\nDetail technique : fichiers.";
    expect(splitTechDetail(reply)?.main).toBe("Q1\n\n---\n\nQ2");
    expect(splitTechDetail("---\nDétail technique : x")).toBeNull();
    expect(splitTechDetail("Pas de règle ici.")).toBeNull();
  });
});
