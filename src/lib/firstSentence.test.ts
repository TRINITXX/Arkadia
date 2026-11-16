import { describe, expect, it } from "vitest";
import { firstLine, firstSentence } from "@/lib/firstSentence";

describe("firstLine", () => {
  it("takes the first line of prose, past blanks, rules and code", () => {
    expect(
      firstLine("\n\n---\n```ts\nconst a = 1;\n```\nVoilà le plan\nsuite"),
    ).toBe("Voilà le plan");
  });

  it("takes off markdown marks, keeping their text", () => {
    expect(
      firstLine(
        "## ✅ **Fini** : `npm test` passe, voir [le lien](https://x.y)",
      ),
    ).toBe("✅ Fini : npm test passe, voir le lien");
    expect(firstLine("> - *Note* : ~~vieux~~ neuf")).toBe("Note : vieux neuf");
  });

  it("drops a closing colon or period, never an ellipsis", () => {
    expect(firstLine("Je vérifie 6 points avant de proposer :")).toBe(
      "Je vérifie 6 points avant de proposer",
    );
    expect(firstLine("Commit fait.")).toBe("Commit fait");
    expect(firstLine("Je regarde...")).toBe("Je regarde...");
  });

  it("is empty when there are no words", () => {
    expect(firstLine("\n```\ncode\n```\n|---|---|\n")).toBe("");
  });
});

describe("firstSentence", () => {
  it("stops at the first sentence's end", () => {
    expect(firstSentence("Je relance Chrome. Puis je lis le journal.")).toBe(
      "Je relance Chrome",
    );
    expect(firstSentence("Ça plante encore ! Je creuse.")).toBe(
      "Ça plante encore !",
    );
  });

  it("keeps a number's dot and a lone sentence whole", () => {
    expect(firstSentence("Je passe à la v2.1 du kit")).toBe(
      "Je passe à la v2.1 du kit",
    );
  });
});
