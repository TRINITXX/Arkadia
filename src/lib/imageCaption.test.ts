import { describe, expect, it } from "vitest";
import { imageCaptions } from "./imageCaption";

const caption = (text: string, path: string, baseDir?: string) =>
  imageCaptions(text, baseDir).get(path.toLowerCase());

describe("imageCaptions", () => {
  it("takes the sentence of the paragraph that holds the path", () => {
    const text =
      "Avant réglage, l'écran affiche le guide.\nC:\\s\\avant_v1.png\n\nSuite.";
    expect(caption(text, "C:\\s\\avant_v1.png")).toBe(
      "Avant réglage, l'écran affiche le guide.",
    );
  });

  it("keeps each list item to its own prose", () => {
    const text =
      "- **Avant** : le guide `C:\\s\\a.png`\n- Après : les adresses\n  C:\\s\\b.png";
    expect(caption(text, "C:\\s\\a.png")).toBe("Avant : le guide");
    expect(caption(text, "C:\\s\\b.png")).toBe("Après : les adresses");
  });

  it("gives a path standing alone the line above it", () => {
    const text =
      "Logo des marques visible.\n\nC:\\s\\logo.png\n\nC:\\s\\logo2.png";
    expect(caption(text, "C:\\s\\logo.png")).toBe("Logo des marques visible.");
    expect(caption(text, "C:\\s\\logo2.png")).toBe("Logo des marques visible.");
  });

  it("reads a table row's other cells", () => {
    const text = "| Quoi | État |\n|---|---|\n| Logo | ✅ C:\\s\\logo.png |";
    expect(caption(text, "C:\\s\\logo.png")).toBe("Logo · ✅");
  });

  it("keeps a heading to its own line", () => {
    const text = "## Avant C:\\s\\h.png\nTexte du paragraphe suivant.";
    expect(caption(text, "C:\\s\\h.png")).toBe("Avant");
  });

  it("leaves inline code verbatim", () => {
    const text = "Le fichier `C:\\Users\\T\\.claude\\x.md` montre C:\\s\\c.png";
    expect(caption(text, "C:\\s\\c.png")).toBe(
      "Le fichier C:\\Users\\T\\.claude\\x.md montre",
    );
  });

  it("gives nothing to a path inside a code fence", () => {
    const text = "Copie :\n\n```\ncp C:\\s\\x.png .\n```";
    expect(caption(text, "C:\\s\\x.png")).toBeUndefined();
  });
});
