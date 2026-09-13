import { describe, expect, it } from "vitest";
import type { SessionSnapshot, SnapshotPane } from "./sessionSnapshot";
import { planReattach } from "./paneReattach";

function pane(paneId: string, wasClaude = false): SnapshotPane {
  return { paneId, cwd: "C:\p", title: paneId, wasClaude };
}

/** One tab: a horizontal split over panes a and b, b focused. */
function split(): SessionSnapshot {
  return {
    savedAt: 1,
    tabs: [
      {
        projectId: "proj",
        tree: {
          kind: "split",
          direction: "horizontal",
          ratio: 0.4,
          first: { kind: "leaf", pane: 0 },
          second: { kind: "leaf", pane: 1 },
        },
        activePane: 1,
        panes: [pane("a", true), pane("b")],
      },
    ],
  };
}

describe("planReattach", () => {
  it("rebuilds the tab on the SAME pane ids when every session is still live", () => {
    const plan = planReattach(split(), ["a", "b"]);
    expect(plan.tabs).toHaveLength(1);
    expect(plan.tabs[0].tree).toEqual({
      kind: "split",
      direction: "horizontal",
      ratio: 0.4,
      first: { kind: "leaf", paneId: "a" },
      second: { kind: "leaf", paneId: "b" },
    });
    expect(plan.tabs[0].activePaneId).toBe("b");
    expect(plan.tabs[0].panes.map((p) => p.id)).toEqual(["a", "b"]);
    expect(plan.tabs[0].claudePaneIds).toEqual(["a"]);
    expect(plan.leftover).toBeNull();
  });

  it("prunes a pane whose shell died and collapses the split onto the survivor", () => {
    const plan = planReattach(split(), ["a"]);
    expect(plan.tabs[0].tree).toEqual({ kind: "leaf", paneId: "a" });
    expect(plan.tabs[0].panes.map((p) => p.id)).toEqual(["a"]);
    expect(plan.leftover).toBeNull();
  });

  it("falls back to the first survivor when the focused pane is gone", () => {
    const plan = planReattach(split(), ["a"]);
    expect(plan.tabs[0].activePaneId).toBe("a");
  });

  it("leaves a fully dead tab to the manual restore path", () => {
    const plan = planReattach(split(), ["other"]);
    expect(plan.tabs).toEqual([]);
    expect(plan.leftover?.tabs).toHaveLength(1);
  });

  it("re-attaches nothing when Rust reports no live session", () => {
    const snap = split();
    const plan = planReattach(snap, []);
    expect(plan.tabs).toEqual([]);
    expect(plan.leftover).toBe(snap);
  });
});
