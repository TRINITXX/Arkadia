/**
 * The display-ready picture of the desktop the phone companion shows: projects
 * in sidebar order, their tabs and panes with badges, the toolbar and prompt
 * bar buttons, the Claude accounts and the terminal palette.
 * Built by the desktop window (which owns all of this state) and relayed as-is
 * by the Rust server, so the phone never re-derives desktop logic.
 */

import { sortActiveProjects } from "@/lib/activeOrder";
import {
  aggregate,
  stateFromTitle,
  type AgentStateValue,
} from "@/lib/agentState";
import type { AccountMark, AccountsState } from "@/lib/accounts";
import { collectPaneIds } from "@/lib/paneTree";
import type {
  Project,
  Tab,
  TerminalPalette,
  ToolbarButton,
  ToolDensity,
  Workspace,
} from "@/types";

/** The sidebar badge: amber = working, green = waiting. Rings: a shell runs
 *  (waiting only), an artifact is open in the tab. */
export type RemoteBadge =
  | "busy"
  | "busy-artifact"
  | "waiting"
  | "waiting-shell"
  | "waiting-artifact"
  | "waiting-shell-artifact"
  | null;

export interface RemotePane {
  id: string;
  title: string;
  badge: RemoteBadge;
  /** Has run Claude: the phone shows the prompt bar buttons for it. */
  claude: boolean;
}

export interface RemoteTab {
  id: string;
  title: string;
  badge: RemoteBadge;
  activePaneId: string;
  /** In split order (left/top first). */
  panes: RemotePane[];
  /** The account the tab runs on; null while there is a single account. */
  account: AccountMark | null;
}

export interface RemoteProject {
  id: string;
  name: string;
  color: string;
  tabs: RemoteTab[];
}

/** A workspace, or `name: null` for projects outside any workspace. */
export interface RemoteGroup {
  name: string | null;
  projects: RemoteProject[];
}

/** A toolbar or prompt bar button; the phone sends back its id to run it. */
export interface RemoteButton {
  id: string;
  kind: "action" | "folder";
  label: string;
  icon: string;
  /** Folders only, in display order. */
  children?: RemoteButton[];
}

export interface RemoteSnapshot {
  /** The sidebar "Active" list. */
  active: RemoteProject[];
  /** Every other project, grouped as in the sidebar's other view. */
  groups: RemoteGroup[];
  palette: TerminalPalette;
  toolbar: RemoteButton[];
  /** Null when the desktop has the prompt bar turned off. */
  promptButtons: RemoteButton[] | null;
  accounts: AccountsState | null;
  /** Automatic account switch on a usage limit. */
  autoSwitch: boolean;
  /** How the modern view opens tool cards (the desktop setting). */
  toolDensity: ToolDensity;
}

export interface RemoteSnapshotInput {
  projects: Project[];
  workspaces: Workspace[];
  tabs: Tab[];
  paneStates: Record<string, AgentStateValue>;
  activeProjectIds: ReadonlySet<string>;
  palette: TerminalPalette;
  toolbarButtons: ToolbarButton[];
  promptButtons: ToolbarButton[];
  promptBarEnabled: boolean;
  claudePaneIds: ReadonlySet<string>;
  accountMarks: Record<string, AccountMark>;
  accounts: AccountsState | null;
  autoSwitch: boolean;
  toolDensity: ToolDensity;
}

export function badgeOf(state: AgentStateValue | undefined): RemoteBadge {
  if (state?.kind === "busy")
    return state.artifactOpen ? "busy-artifact" : "busy";
  if (state?.kind === "waiting") {
    if (state.shellRunning)
      return state.artifactOpen ? "waiting-shell-artifact" : "waiting-shell";
    return state.artifactOpen ? "waiting-artifact" : "waiting";
  }
  return null;
}

/** A pane title without Claude's status glyph (the badge carries it). */
export function plainTitle(title: string): string {
  const text = stateFromTitle(title)
    ? [...title.trimStart()].slice(1).join("").trimStart()
    : title.trim();
  return text || "pwsh";
}

function remoteButtons(buttons: ToolbarButton[]): RemoteButton[] {
  return [...buttons]
    .sort((a, b) => a.order - b.order)
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      label: b.label,
      icon: b.icon,
      ...(b.kind === "folder" ? { children: remoteButtons(b.children) } : {}),
    }));
}

function remoteTab(
  tab: Tab,
  { paneStates, claudePaneIds, accountMarks }: RemoteSnapshotInput,
): RemoteTab {
  const paneIds = collectPaneIds(tab.tree).filter((id) => tab.panes[id]);
  return {
    id: tab.id,
    title: plainTitle(tab.panes[tab.activePaneId]?.title ?? ""),
    badge: badgeOf(
      aggregate(paneIds.map((id) => paneStates[id] ?? { kind: "none" })),
    ),
    activePaneId: tab.activePaneId,
    panes: paneIds.map((id) => ({
      id,
      title: plainTitle(tab.panes[id].title),
      badge: badgeOf(paneStates[id]),
      claude: claudePaneIds.has(id),
    })),
    account: accountMarks[tab.id] ?? null,
  };
}

export function buildRemoteSnapshot(
  input: RemoteSnapshotInput,
): RemoteSnapshot {
  const { projects, workspaces, tabs, activeProjectIds } = input;
  const toRemote = (p: Project): RemoteProject => ({
    id: p.id,
    name: p.name,
    color: p.color,
    tabs: tabs
      .filter((t) => t.projectId === p.id)
      .map((t) => remoteTab(t, input)),
  });
  const byOrder = (a: { order: number }, b: { order: number }) =>
    a.order - b.order;

  const others = projects.filter((p) => !activeProjectIds.has(p.id));
  // Same root order as the sidebar: workspaces and placed loose projects share
  // one axis; loose projects never placed sink to a group at the bottom.
  const root: { order: number; group: RemoteGroup }[] = [];
  for (const w of workspaces) {
    const inside = others
      .filter((p) => p.workspaceId === w.id)
      .sort(byOrder)
      .map(toRemote);
    if (inside.length > 0)
      root.push({ order: w.order, group: { name: w.name, projects: inside } });
  }
  const loose = others.filter((p) => (p.workspaceId ?? null) === null);
  for (const p of loose) {
    if (typeof p.rootOrder === "number")
      root.push({
        order: p.rootOrder,
        group: { name: null, projects: [toRemote(p)] },
      });
  }
  root.sort(byOrder);
  const groups = root.map((r) => r.group);
  const unplaced = loose
    .filter((p) => typeof p.rootOrder !== "number")
    .sort(byOrder)
    .map(toRemote);
  if (unplaced.length > 0) groups.push({ name: null, projects: unplaced });

  return {
    active: sortActiveProjects(
      projects.filter((p) => activeProjectIds.has(p.id)),
    ).map(toRemote),
    groups,
    palette: input.palette,
    toolbar: remoteButtons(input.toolbarButtons),
    promptButtons: input.promptBarEnabled
      ? remoteButtons(input.promptButtons)
      : null,
    accounts: input.accounts,
    autoSwitch: input.autoSwitch,
    toolDensity: input.toolDensity,
  };
}
