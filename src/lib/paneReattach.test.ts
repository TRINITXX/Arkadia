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

  describe("a tab opened for a command (--tab-add --name)", () => {
    /** The split tab, plus a single-pane tab named "Serveur dev". */
    function withDevServer(extra: Partial<SnapshotPane> = {}): SessionSnapshot {
      const snap = split();
      snap.tabs.push({
        projectId: "proj",
        tree: { kind: "leaf", pane: 0 },
        activePane: 0,
        panes: [{ ...pane("dev"), label: "Serveur dev", ...extra }],
      });
      return snap;
    }

    it("is not offered to the restore after a relaunch: its command is not relaunched", () => {
      const snap = withDevServer();
      expect(planReattach(snap, []).leftover?.tabs).toEqual([snap.tabs[0]]);
    });

    it("is not offered either after a reload that found its shell dead", () => {
      const plan = planReattach(withDevServer(), ["a", "b"]);
      expect(plan.tabs).toHaveLength(1);
      expect(plan.leftover).toBeNull();
    });

    it("leaves nothing to restore when it is the only tab", () => {
      const alone = { savedAt: 1, tabs: [withDevServer().tabs[1]] };
      expect(planReattach(alone, []).leftover).toBeNull();
    });

    it("is restored once Claude ran in it: it comes back on its conversation", () => {
      const terminal = withDevServer({ wasClaude: true });
      expect(planReattach(terminal, []).leftover).toBe(terminal);
      const chat = withDevServer({
        wasClaude: true,
        chat: { cwd: "C:\\p", resume: "s1" },
      });
      expect(planReattach(chat, []).leftover).toBe(chat);
    });

    it("is restored whole when only one pane of its split has a fixed name", () => {
      const snap = split();
      snap.tabs[0].panes[1].label = "Serveur dev";
      expect(planReattach(snap, []).leftover).toBe(snap);
    });
  });
});
