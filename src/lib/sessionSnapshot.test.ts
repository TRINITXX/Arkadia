import { describe, expect, it } from "vitest";
import type { PaneTree, Tab } from "@/types";
import {
  buildSessionSnapshot,
  collectTreePaneIds,
  materializeTree,
  normalizeSessionSnapshot,
} from "./sessionSnapshot";

function tab(tree: PaneTree, panes: string[], projectId = "proj"): Tab {
  return {
    id: "tab1",
    projectId,
    tree,
    activePaneId: panes[0],
    panes: Object.fromEntries(
      panes.map((id) => [id, { id, title: `t-${id}`, cwd: `C:\\w\\${id}` }]),
    ),
  };
}

const SPLIT: PaneTree = {
  kind: "split",
  direction: "horizontal",
  ratio: 0.3,
  first: { kind: "leaf", paneId: "a" },
  second: {
    kind: "split",
    direction: "vertical",
    ratio: 0.5,
    first: { kind: "leaf", paneId: "b" },
    second: { kind: "leaf", paneId: "c" },
  },
};

describe("sessionSnapshot", () => {
  it("round-trips a split tree through serialize + materialize", () => {
    const snap = buildSessionSnapshot(
      [tab(SPLIT, ["a", "b", "c"])],
      new Set(["b"]),
      123,
    );
    expect(snap.tabs).toHaveLength(1);
    const t = snap.tabs[0];
    expect(t.panes.map((p) => p.paneId)).toEqual(["a", "b", "c"]);
    expect(t.panes[1].wasClaude).toBe(true);
    expect(t.panes[0].wasClaude).toBe(false);

    const rebuilt = materializeTree(t.tree, ["n1", "n2", "n3"]);
    expect(collectTreePaneIds(rebuilt)).toEqual(["n1", "n2", "n3"]);
    expect(rebuilt.kind).toBe("split");
    if (rebuilt.kind === "split") {
      expect(rebuilt.ratio).toBe(0.3);
      expect(rebuilt.direction).toBe("horizontal");
    }
  });

  it("keeps cwd and title per pane", () => {
    const snap = buildSessionSnapshot(
      [tab({ kind: "leaf", paneId: "a" }, ["a"])],
      new Set(),
      1,
    );
    expect(snap.tabs[0].panes[0].cwd).toBe("C:\\w\\a");
    expect(snap.tabs[0].panes[0].title).toBe("t-a");
  });

  it("normalize round-trips its own output", () => {
    const snap = buildSessionSnapshot(
      [tab(SPLIT, ["a", "b", "c"])],
      new Set(["a"]),
      42,
    );
    const parsed = normalizeSessionSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed).toEqual(snap);
  });

  it("normalize rejects corrupt shapes", () => {
    expect(normalizeSessionSnapshot(null)).toBeNull();
    expect(normalizeSessionSnapshot({ savedAt: 1, tabs: [{}] })).toBeNull();
    // Leaf index out of bounds → rejected.
    expect(
      normalizeSessionSnapshot({
        savedAt: 1,
        tabs: [
          {
            projectId: "p",
            activePane: 0,
            tree: { kind: "leaf", pane: 5 },
            panes: [{ paneId: "a", cwd: null, title: "", wasClaude: false }],
          },
        ],
      }),
    ).toBeNull();
  });
});
