import { describe, it, expect } from "vitest";
import { artifactPageUrl, isRepublish } from "@/lib/openLink";

describe("artifactPageUrl", () => {
  it("drops what Claude Code adds to the link it opens", () => {
    expect(
      artifactPageUrl("https://claude.ai/artifact/Qbo93X?via=auto_preview#top"),
    ).toBe("https://claude.ai/artifact/Qbo93X");
  });
});

describe("isRepublish", () => {
  it("reads the mark of the artifact-refresh hook", () => {
    expect(isRepublish("https://claude.ai/artifact/X?arkadia=refresh")).toBe(
      true,
    );
    expect(isRepublish("https://claude.ai/artifact/X?via=auto_preview")).toBe(
      false,
    );
  });
});
