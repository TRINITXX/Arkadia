/**
 * Re-attaching the UI to PTYs that are still running.
 *
 * The webview can reload while the Rust process keeps going — the freeze
 * watchdog does exactly that. Pane ids are the Rust session ids and survive
 * that reload, so the tabs must be rebuilt on the SAME sessions: scrollback and
 * running processes come back untouched. Spawning fresh panes instead (what the
 * manual "restore" path does after a real relaunch) would both lose the work and
 * orphan the live sessions, which then emit frames nobody reads.
 *
 * Pure decision logic, no Tauri: the caller supplies the persisted snapshot and
 * the ids Rust still knows about.
 */

import type { PaneState, PaneTree } from "@/types";
import type {
  SessionSnapshot,
  SnapshotTab,
  SnapshotTree,
} from "@/lib/sessionSnapshot";

/** One tab rebuilt on live sessions, ready to be turned into a `Tab`. */
export interface ReattachedTab {
  projectId: string;
  tree: PaneTree;
  activePaneId: string;
  panes: PaneState[];
  /** Saved ids of the panes that ran Claude, restricted to the live ones. */
  claudePaneIds: string[];
}

export interface ReattachPlan {
  tabs: ReattachedTab[];
  /** Snapshot tabs that kept nothing alive, left to the manual restore button
   *  (null when every tab was re-attached, so the button stops offering). */
  leftover: SessionSnapshot | null;
}

/**
 * Rebuilds a live tree, dropping leaves whose session is gone and collapsing a
 * split that keeps only one child. Returns null when nothing survives.
 *
 * A pane's shell can exit between the snapshot write and the reload, so a
 * partially live tab is a real case — pruning it keeps the surviving panes
 * rather than sending the whole tab down the respawn path.
 */
export function reattachTree(
  tree: SnapshotTree,
  paneIds: readonly string[],
  live: ReadonlySet<string>,
): PaneTree | null {
  if (tree.kind === "leaf") {
    const paneId = paneIds[tree.pane];
    return paneId && live.has(paneId) ? { kind: "leaf", paneId } : null;
  }
  const first = reattachTree(tree.first, paneIds, live);
  const second = reattachTree(tree.second, paneIds, live);
  if (first && second) {
    return {
      kind: "split",
      direction: tree.direction,
      ratio: tree.ratio,
      first,
      second,
    };
  }
  return first ?? second;
}

/** Leaf pane ids of a live tree, left-to-right. */
function leafIds(tree: PaneTree): string[] {
  if (tree.kind === "leaf") return [tree.paneId];
  return [...leafIds(tree.first), ...leafIds(tree.second)];
}

function reattachTab(
  tab: SnapshotTab,
  live: ReadonlySet<string>,
): ReattachedTab | null {
  const ids = tab.panes.map((p) => p.paneId);
  const tree = reattachTree(tab.tree, ids, live);
  if (!tree) return null;

  const survivors = new Set(leafIds(tree));
  const kept = tab.panes.filter((p) => survivors.has(p.paneId));
  const saved = tab.panes[tab.activePane];
  const activePaneId =
    saved && survivors.has(saved.paneId) ? saved.paneId : kept[0].paneId;

  return {
    projectId: tab.projectId,
    tree,
    activePaneId,
    // `cwd` stays null: the shell re-reports it via OSC 7, exactly as it does
    // for a freshly spawned pane. The title is kept so the tab is not blank
    // until the first frame lands.
    panes: kept.map((p) => ({ id: p.paneId, title: p.title, cwd: null })),
    claudePaneIds: kept.filter((p) => p.wasClaude).map((p) => p.paneId),
  };
}

/**
 * Splits the snapshot into what can be re-attached to live sessions and what
 * remains for the manual restore path.
 */
export function planReattach(
  snapshot: SessionSnapshot | null,
  liveIds: readonly string[],
): ReattachPlan {
  if (!snapshot || liveIds.length === 0) {
    return { tabs: [], leftover: snapshot };
  }
  const live = new Set(liveIds);
  const tabs: ReattachedTab[] = [];
  const orphaned: SnapshotTab[] = [];
  for (const tab of snapshot.tabs) {
    const reattached = reattachTab(tab, live);
    if (reattached) tabs.push(reattached);
    else orphaned.push(tab);
  }
  return {
    tabs,
    leftover:
      orphaned.length > 0
        ? { savedAt: snapshot.savedAt, tabs: orphaned }
        : null,
  };
}
