import { describe, it, expect } from "vitest";
import {
  MAX_ARTIFACTS_PER_TAB,
  closeArtifact,
  closePanel,
  dropTab,
  hasPanel,
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
      "click",
    );
    const b = openArtifact(
      a.state,
      "t1",
      "https://claude.ai/artifact/b",
      "main",
      next,
      "click",
    );
    expect(b.state.t1.items.map((i) => i.url)).toEqual([
      "https://claude.ai/artifact/a",
      "https://claude.ai/artifact/b",
    ]);
    expect(b.state.t1.activeKey).toBe("k2");
    expect(b.closed).toEqual([]);
  });

  it("brings a link already open forward, reloading it only when Claude publishes it again", () => {
    const next = keys();
    let state: ArtifactsByTab = {};
    state = openArtifact(
      state,
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
      "click",
    ).state;
    state = openArtifact(
      state,
      "t1",
      "https://claude.ai/artifact/b",
      "main",
      next,
      "click",
    ).state;
    const again = openArtifact(
      state,
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
      "click",
    );
    expect(again.state.t1.items).toHaveLength(2);
    expect(again.state.t1.activeKey).toBe("k1");
    expect(again.state.t1.items[0].nonce).toBe(1);
    const published = openArtifact(
      again.state,
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
      "publish",
    );
    expect(published.state.t1.items[0].nonce).toBe(2);
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
        "click",
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
      "click",
    );
    const b = openArtifact(
      a.state,
      "t2",
      "https://claude.ai/artifact/a",
      "other",
      next,
      "click",
    );
    expect(b.state.t1.items).toHaveLength(1);
    expect(b.state.t2.items[0].accountId).toBe("other");
  });

  it("brings the right neighbour forward on close, and parks the closed one", () => {
    const next = keys();
    let state: ArtifactsByTab = {};
    for (const id of ["a", "b", "c"]) {
      state = openArtifact(
        state,
        "t1",
        `https://claude.ai/artifact/${id}`,
        "main",
        next,
        "click",
      ).state;
    }
    state = selectArtifact(state, "t1", "k2");
    expect(state.t1.activeKey).toBe("k2");
    const closed = closeArtifact(state, "t1", "k2");
    expect(closed.state.t1.activeKey).toBe("k3");
    expect(closed.state.t1.parked?.key).toBe("k2");
    expect(closed.closed).toEqual([]);
    // Each close parks the closed page in place of the one parked before.
    let last = closeArtifact(closed.state, "t1", "k1");
    expect(last.closed).toEqual(["k2"]);
    last = closeArtifact(last.state, "t1", "k3");
    expect(hasPanel(last.state.t1)).toBe(false);
    expect(last.state.t1.parked?.key).toBe("k3");
    expect(last.closed).toEqual(["k1"]);
  });

  it("keeps the artifact on screen loaded when the panel closes", () => {
    const next = keys();
    let state: ArtifactsByTab = {};
    for (const id of ["a", "b"]) {
      state = openArtifact(
        state,
        "t1",
        `https://claude.ai/artifact/${id}`,
        "main",
        next,
        "click",
      ).state;
    }
    const closed = closePanel(state, "t1");
    expect(closed.closed).toEqual(["k1"]);
    expect(closed.state.t1.parked?.key).toBe("k2");
    // Its link brings the same page back, as it was.
    const back = openArtifact(
      closed.state,
      "t1",
      "https://claude.ai/artifact/b",
      "main",
      next,
      "click",
    );
    expect(back.state.t1.items).toEqual([closed.state.t1.parked]);
    expect(back.state.t1.parked).toBeUndefined();
    // Another artifact parked in its place closes it; the closed tab drops
    // the parked one for good.
    const other = openArtifact(
      back.state,
      "t1",
      "https://claude.ai/artifact/c",
      "main",
      next,
      "click",
    );
    const replaced = closePanel(selectArtifact(other.state, "t1", "k3"), "t1");
    expect(replaced.closed).toEqual(["k2"]);
    expect(replaced.state.t1.parked?.key).toBe("k3");
    expect(dropTab(replaced.state, "t1").closed).toEqual(["k3"]);
  });

  it("reloads on a republish only what the tab holds, without reopening it", () => {
    const next = keys();
    const open = openArtifact(
      {},
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
      "click",
    ).state;
    const shown = openArtifact(
      open,
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
      "republish",
    ).state;
    expect(shown.t1.items[0].nonce).toBe(2);
    const parked = closePanel(shown, "t1").state;
    const refreshed = openArtifact(
      parked,
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
      "republish",
    ).state;
    expect(hasPanel(refreshed.t1)).toBe(false);
    expect(refreshed.t1.parked?.nonce).toBe(3);
    const closed = openArtifact(
      parked,
      "t1",
      "https://claude.ai/artifact/b",
      "main",
      next,
      "republish",
    );
    expect(closed.state).toBe(parked);
  });

  it("closes every artifact of a tab that closes", () => {
    const next = keys();
    let state = openArtifact(
      {},
      "t1",
      "https://claude.ai/artifact/a",
      "main",
      next,
      "click",
    ).state;
    state = openArtifact(
      state,
      "t1",
      "https://claude.ai/artifact/b",
      "main",
      next,
      "click",
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
      "click",
    ).state;
    expect(setArtifactTitle(state, "k1", "Kit visuel").t1.items[0].title).toBe(
      "Kit visuel",
    );
  });
});
