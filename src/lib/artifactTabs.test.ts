import { describe, it, expect } from "vitest";
import {
  MAX_ARTIFACTS_PER_TAB,
  closeArtifact,
  dropTab,
  openArtifact,
  selectArtifact,
  setArtifactTitle,
  type ArtifactsByTab,
} from "@/lib/artifactTabs";

function keys(): () => string {
  let n = 0;
  return () => `k${++n}`;
}

describe("artifact tabs", () => {
  it("adds a new link as the tab's active artifact", () => {
    const next = keys();
    const a = openArtifact(
      {},
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
    );
    const b = openArtifact(
      a.state,
      "t1",
      "https://claude.ai/artifact/b",
      "main",
      next,
    );
    expect(b.state.t1.items.map((i) => i.url)).toEqual([
      "https://claude.ai/artifact/a",
      "https://claude.ai/artifact/b",
    ]);
    expect(b.state.t1.activeKey).toBe("k2");
    expect(b.closed).toEqual([]);
  });

  it("brings a link already open forward and reloads it, without a duplicate", () => {
    const next = keys();
    let state: ArtifactsByTab = {};
    state = openArtifact(
      state,
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
    ).state;
    state = openArtifact(
      state,
      "t1",
      "https://claude.ai/artifact/b",
      "main",
      next,
    ).state;
    const again = openArtifact(
      state,
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
    );
    expect(again.state.t1.items).toHaveLength(2);
    expect(again.state.t1.activeKey).toBe("k1");
    expect(again.state.t1.items[0].nonce).toBe(2);
  });

  it("closes the oldest artifact beyond the limit", () => {
    const next = keys();
    let change = { state: {} as ArtifactsByTab, closed: [] as string[] };
    for (let i = 0; i <= MAX_ARTIFACTS_PER_TAB; i++) {
      change = openArtifact(
        change.state,
        "t1",
        `https://claude.ai/artifact/${i}`,
        "main",
        next,
      );
    }
    expect(change.state.t1.items).toHaveLength(MAX_ARTIFACTS_PER_TAB);
    expect(change.closed).toEqual(["k1"]);
  });

  it("keeps each tab's artifacts apart", () => {
    const next = keys();
    const a = openArtifact(
      {},
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
    );
    const b = openArtifact(
      a.state,
      "t2",
      "https://claude.ai/artifact/a",
      "other",
      next,
    );
    expect(b.state.t1.items).toHaveLength(1);
    expect(b.state.t2.items[0].accountId).toBe("other");
  });

  it("brings the right neighbour forward on close, and drops an empty tab", () => {
    const next = keys();
    let state: ArtifactsByTab = {};
    for (const id of ["a", "b", "c"]) {
      state = openArtifact(
        state,
        "t1",
        `https://claude.ai/artifact/${id}`,
        "main",
        next,
      ).state;
    }
    state = selectArtifact(state, "t1", "k2");
    expect(state.t1.activeKey).toBe("k2");
    const closed = closeArtifact(state, "t1", "k2");
    expect(closed.state.t1.activeKey).toBe("k3");
    expect(closed.closed).toEqual(["k2"]);
    let last = closeArtifact(closed.state, "t1", "k1");
    last = closeArtifact(last.state, "t1", "k3");
    expect(last.state.t1).toBeUndefined();
  });

  it("closes every artifact of a tab that closes", () => {
    const next = keys();
    let state = openArtifact(
      {},
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
    ).state;
    state = openArtifact(
      state,
      "t1",
      "https://claude.ai/artifact/b",
      "main",
      next,
    ).state;
    const dropped = dropTab(state, "t1");
    expect(dropped.closed).toEqual(["k1", "k2"]);
    expect(dropped.state).toEqual({});
  });

  it("names a tab after its page's title", () => {
    const state = openArtifact(
      {},
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      keys(),
    ).state;
    expect(setArtifactTitle(state, "k1", "Kit visuel").t1.items[0].title).toBe(
      "Kit visuel",
    );
  });
});
