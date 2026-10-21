import { describe, it, expect } from "vitest";
import { artifactPageUrl, isArtifactUrl, isRepublish } from "@/lib/openLink";

describe("isArtifactUrl", () => {
  it("takes both artifact link shapes and nothing else", () => {
    expect(
      isArtifactUrl("https://claude.ai/artifact/QXVbCtb1dyAMJHWDbZpB4d"),
    ).toBe(true);
    expect(isArtifactUrl("https://claude.ai/code/artifact/0b4f-uuid")).toBe(
      true,
    );
    expect(isArtifactUrl("https://claude.ai/chat/123")).toBe(false);
    expect(isArtifactUrl("https://claude.ai.evil.com/artifact/x")).toBe(false);
    expect(isArtifactUrl("http://claude.ai/artifact/x")).toBe(false);
    expect(isArtifactUrl("not a url")).toBe(false);
  });
});

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
