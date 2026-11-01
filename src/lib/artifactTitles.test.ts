import { describe, expect, it } from "vitest";
import { artifactId } from "@/lib/artifactTitles";

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
});
