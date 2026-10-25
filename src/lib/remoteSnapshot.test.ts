import { describe, expect, it } from "vitest";
import type {
  Project,
  Tab,
  TerminalPalette,
  ToolbarButton,
  Workspace,
} from "@/types";
import type { AgentStateValue } from "./agentState";
import { agentStateOf } from "@/mobile/RemoteBadgeDot";
import {
  badgeOf,
  buildRemoteSnapshot,
  plainTitle,
  type RemoteBadge,
  type RemoteSnapshotInput,
} from "./remoteSnapshot";

const palette: TerminalPalette = {
  id: "wez",
  name: "Wez",
  bg: "#000",
  fg: "#fff",
  ansi: [],
};

function project(id: string, extra: Partial<Project> = {}): Project {
  return { id, name: id, path: `C:/${id}`, color: "#f00", order: 0, ...extra };
}

function tab(id: string, projectId: string, titles: string[]): Tab {
  const ids = titles.map((_, i) => `${id}-p${i}`);
  const tree: Tab["tree"] =
    ids.length === 1
      ? { kind: "leaf", paneId: ids[0] }
      : {
          kind: "split",
          direction: "horizontal",
          ratio: 0.5,
          first: { kind: "leaf", paneId: ids[0] },
          second: { kind: "leaf", paneId: ids[1] },
        };
  return {
    id,
    projectId,
    tree,
    activePaneId: ids[ids.length - 1],
    panes: Object.fromEntries(
      ids.map((pid, i) => [pid, { id: pid, title: titles[i], cwd: null }]),
    ),
  };
}

const busy: AgentStateValue = { kind: "busy" };
const waitingWithShell: AgentStateValue = {
  kind: "waiting",
  session_id: "",
  shellRunning: true,
};

describe("badgeOf", () => {
  it("names the artifact ring, alone or with the shell ring", () => {
    expect(badgeOf({ kind: "busy", artifactOpen: true })).toBe("busy-artifact");
    expect(badgeOf({ ...waitingWithShell, artifactOpen: true })).toBe(
      "waiting-shell-artifact",
    );
    expect(
      badgeOf({ kind: "waiting", session_id: "", artifactOpen: true }),
    ).toBe("waiting-artifact");
  });

  it("reads back on the phone as the same rings", () => {
    const badges: RemoteBadge[] = [
      "busy",
      "busy-artifact",
      "waiting",
      "waiting-shell",
      "waiting-artifact",
      "waiting-shell-artifact",
      null,
    ];
    for (const badge of badges)
      expect(badgeOf(agentStateOf(badge))).toBe(badge);
  });
});

describe("plainTitle", () => {
  it("drops Claude's status glyph, keeps plain titles", () => {
    expect(plainTitle("✳ Mobile app")).toBe("Mobile app");
    expect(plainTitle("⠂ Building")).toBe("Building");
    expect(plainTitle("C:\\Users\\me")).toBe("C:\\Users\\me");
    expect(plainTitle("")).toBe("pwsh");
  });
});

/** Everything empty; each test fills what it checks. */
function input(extra: Partial<RemoteSnapshotInput>): RemoteSnapshotInput {
  return {
    projects: [],
    workspaces: [],
    tabs: [],
    paneStates: {},
    activeProjectIds: new Set(),
    palette,
    toolbarButtons: [],
    promptButtons: [],
    promptBarEnabled: true,
    claudePaneIds: new Set(),
    accountMarks: {},
    accounts: null,
    autoSwitch: true,
    toolDensity: "preview",
    ...extra,
  };
}

describe("buildRemoteSnapshot", () => {
  it("lists active projects apart, with tabs, panes in split order and badges", () => {
    const snap = buildRemoteSnapshot(
      input({
        projects: [project("arkadia"), project("site")],
        tabs: [tab("t1", "arkadia", ["⠂ Build", "✳ Review"])],
        paneStates: { "t1-p0": busy, "t1-p1": waitingWithShell },
        activeProjectIds: new Set(["arkadia"]),
        claudePaneIds: new Set(["t1-p0", "t1-p1"]),
      }),
    );
    expect(snap.active.map((p) => p.id)).toEqual(["arkadia"]);
    expect(snap.active[0].tabs).toEqual([
      {
        id: "t1",
        title: "Review",
        // Waiting outranks working: the user has something to answer.
        badge: "waiting-shell",
        activePaneId: "t1-p1",
        panes: [
          { id: "t1-p0", title: "Build", badge: "busy", claude: true },
          {
            id: "t1-p1",
            title: "Review",
            badge: "waiting-shell",
            claude: true,
          },
        ],
        account: null,
      },
    ]);
    expect(snap.groups).toEqual([
      {
        name: null,
        projects: [{ id: "site", name: "site", color: "#f00", tabs: [] }],
      },
    ]);
  });

  it("orders the other projects like the sidebar", () => {
    const workspaces: Workspace[] = [
      { id: "w2", name: "Clients", order: 2, collapsed: false },
      { id: "w1", name: "Perso", order: 0, collapsed: false },
      { id: "w3", name: "Empty", order: 3, collapsed: false },
    ];
    const snap = buildRemoteSnapshot(
      input({
        projects: [
          project("b", { workspaceId: "w1", order: 1 }),
          project("a", { workspaceId: "w1", order: 0 }),
          project("c", { workspaceId: "w2" }),
          project("placed", { rootOrder: 1 }),
          project("loose"),
        ],
        workspaces,
      }),
    );
    expect(
      snap.groups.map((g) => [g.name, g.projects.map((p) => p.id)]),
    ).toEqual([
      ["Perso", ["a", "b"]],
      [null, ["placed"]],
      ["Clients", ["c"]],
      [null, ["loose"]],
    ]);
  });

  it("sends the buttons in display order, and no prompt bar when it is off", () => {
    const buttons: ToolbarButton[] = [
      {
        id: "b",
        kind: "action",
        label: "Claude",
        icon: "bot",
        command: "ccd",
        order: 1,
      },
      {
        id: "f",
        kind: "folder",
        label: "Git",
        icon: "git-branch",
        order: 0,
        children: [
          {
            id: "c",
            kind: "action",
            label: "Push",
            icon: "",
            command: "git push",
            order: 0,
          },
        ],
      },
    ];
    const snap = buildRemoteSnapshot(
      input({
        toolbarButtons: buttons,
        promptButtons: buttons,
        promptBarEnabled: false,
      }),
    );
    expect(snap.toolbar).toEqual([
      {
        id: "f",
        kind: "folder",
        label: "Git",
        icon: "git-branch",
        children: [{ id: "c", kind: "action", label: "Push", icon: "" }],
      },
      { id: "b", kind: "action", label: "Claude", icon: "bot" },
    ]);
    expect(snap.promptButtons).toBeNull();
  });
});
