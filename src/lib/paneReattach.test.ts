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

  it("brings a chat pane back as a chat, never as a terminal Claude", () => {
    const snap = split();
    snap.tabs[0].panes[0] = {
      ...pane("a", true),
      chat: { cwd: "C:\p", resume: "s1" },
    };
    const plan = planReattach(snap, ["a", "b"]);
    expect(plan.tabs[0].panes[0].chat).toEqual({ cwd: "C:\p", resume: "s1" });
    expect(plan.tabs[0].claudePaneIds).toEqual([]);
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

  it("keeps the Claude account of every re-attached pane", () => {
    const snap = split();
    snap.tabs[0].panes[1].accountId = "b2c3";
    const plan = planReattach(snap, ["a", "b"]);
    expect(plan.tabs[0].panes.map((p) => p.accountId)).toEqual([
      undefined,
      "b2c3",
    ]);
  });

  it("keeps the fixed name of a re-attached pane: its command still runs", () => {
    const snap = split();
    snap.tabs[0].panes[1].label = "Serveur dev";
    const plan = planReattach(snap, ["a", "b"]);
    expect(plan.tabs[0].panes.map((p) => p.label)).toEqual([
      undefined,
      "Serveur dev",
    ]);
  });

  it("re-attaches nothing when Rust reports no live session", () => {
    const snap = split();
    const plan = planReattach(snap, []);
    expect(plan.tabs).toEqual([]);
    expect(plan.leftover).toBe(snap);
  });
});
