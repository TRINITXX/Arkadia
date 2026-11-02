import { describe, expect, it } from "vitest";
import { artifactCardTitle, artifactId } from "@/lib/artifactTitles";

describe("an artifact's title for its chat card", () => {
  it("is found by the artifact's id, whatever the link's form", () => {
    expect(artifactId("https://claude.ai/artifact/TaXqnsUE12")).toBe(
      "TaXqnsUE12",
    );
    expect(artifactId("https://claude.ai/code/artifact/ab-12?x=1")).toBe(
      "ab-12",
    );
    expect(artifactId("https://example.com/page")).toBeNull();
  });

  it("is the panel's title, else the link's words, else its id shortened", () => {
    const href = "https://claude.ai/code/artifact/0b4f9c2e-77aa";
    expect(artifactCardTitle(href, "Rapport", "Visibilité")).toBe("Visibilité");
    expect(artifactCardTitle(href, " Rapport ", null)).toBe("Rapport");
    // A bare link: its words are the URL itself.
    expect(artifactCardTitle(href, href, null)).toBe("0b4f9c2e…");
    expect(
      artifactCardTitle("https://claude.ai/artifact/Ab12", "https://x", null),
    ).toBe("Ab12");
  });
});
