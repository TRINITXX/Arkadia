import { describe, expect, it } from "vitest";
import { publishedArtifact } from "@/lib/chat/chatArtifactOpen";

const URL = "https://claude.ai/artifact/TaXqnsUE7Z8zgyqTjCSH1u";
const user = (result: unknown) => ({ type: "user", tool_use_result: result });

describe("publishedArtifact", () => {
  it("opens a first publish, never a republish", () => {
    expect(
      publishedArtifact(user({ url: URL, artifact_id: "d73c", title: "T" })),
    ).toBe(URL);
    expect(publishedArtifact(user({ url: URL, updated: true }))).toBeNull();
  });

  it("leaves a subagent's publish closed, as the terminal does", () => {
    expect(
      publishedArtifact({
        ...user({ url: URL, artifact_id: "d73c" }),
        parent_tool_use_id: "toolu_1",
      }),
    ).toBeNull();
  });

  it("leaves reads, listings, assets and other tools alone", () => {
    expect(publishedArtifact(user({ read: { url: URL } }))).toBeNull();
    expect(publishedArtifact(user({ artifacts: [{ url: URL }] }))).toBeNull();
    expect(publishedArtifact(user({ url: `${URL}/assets/abc` }))).toBeNull();
    expect(publishedArtifact(user({ stdout: URL }))).toBeNull();
    expect(
      publishedArtifact({ type: "assistant", tool_use_result: { url: URL } }),
    ).toBeNull();
  });
});
