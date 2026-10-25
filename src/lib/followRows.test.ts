import { describe, expect, it } from "vitest";
import { followRows } from "./followRows";
import type { RemoteBadge, RemoteSnapshot, RemoteTab } from "./remoteSnapshot";

const tab = (id: string, badge: RemoteBadge, panes: string[]): RemoteTab => ({
  id,
  title: id,
  badge,
  activePaneId: panes[0],
  panes: panes.map((p) => ({ id: p, title: p, badge, claude: true })),
  account: null,
});

// The same case as src-tauri `remote::activity` tests.
const snapshot = {
  active: [
    {
      id: "p1",
      name: "P1",
      color: "#fff",
      tabs: [
        tab("t1", "waiting", ["a"]),
        tab("t2", "busy-artifact", ["b", "c"]),
        tab("t3", null, ["d"]),
      ],
    },
  ],
  groups: [
    {
      name: "VTC",
      projects: [
        {
          id: "p2",
          name: "P2",
          color: "#fff",
          tabs: [tab("t4", "busy", ["e"])],
        },
      ],
    },
  ],
} as unknown as RemoteSnapshot;

describe("followRows", () => {
  it("lists the followed tabs in the sidebar order, with their state", () => {
    expect(
      followRows(snapshot, new Set(["e", "a", "c", "d"])).map((r) => r.s),
    ).toEqual(["w", "b", "i", "b"]);
  });

  it("names each tab's project and title", () => {
    expect(followRows(snapshot, new Set(["e"]))).toEqual([
      { s: "b", p: "P2", t: "t4" },
    ]);
  });

  it("is empty when no tab is followed", () => {
    expect(followRows(snapshot, new Set())).toEqual([]);
  });
});
