/**
 * Snapshot of the open tabs (splits, cwds, Claude sessions) persisted with the
 * store, so an on-demand "restore previous session" can rebuild them after a
 * relaunch — including `claude --resume` in the panes that ran Claude.
 *
 * Pane ids do not survive a restart (fresh PTYs are spawned), so trees are
 * serialized with leaf INDICES into the tab's pane list, and materialized back
 * with the freshly-spawned ids.
 */

import type { PaneTree, Tab } from "@/types";

/** A serialized pane tree: leaves carry an index into `SnapshotTab.panes`. */
export type SnapshotTree =
  | { kind: "leaf"; pane: number }
  | {
      kind: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      first: SnapshotTree;
      second: SnapshotTree;
    };

export interface SnapshotPane {
  /** Pane id AT SAVE TIME — used to look up the Claude session to resume
   *  (the hook-written pane map survives on disk); never reused as a live id. */
  paneId: string;
  /** Live cwd when saved (null = never reported; restore falls back to the
   *  project root). */
  cwd: string | null;
  title: string;
  /** True when the pane ever ran a Claude session (sticky) — restore relaunches
   *  it with `claude --resume <session>`. */
  wasClaude: boolean;
}

export interface SnapshotTab {
  projectId: string;
  tree: SnapshotTree;
  /** Index (into `panes`) of the focused pane. */
  activePane: number;
  panes: SnapshotPane[];
}

export interface SessionSnapshot {
  savedAt: number;
  tabs: SnapshotTab[];
}

function serializeTree(
  tree: PaneTree,
  indexOf: Map<string, number>,
): SnapshotTree {
  if (tree.kind === "leaf") {
    return { kind: "leaf", pane: indexOf.get(tree.paneId) ?? 0 };
  }
  return {
    kind: "split",
    direction: tree.direction,
    ratio: tree.ratio,
    first: serializeTree(tree.first, indexOf),
    second: serializeTree(tree.second, indexOf),
  };
}

/** Rebuilds a live tree from a snapshot, given the freshly-spawned pane ids
 *  (one per snapshot pane, same order). */
export function materializeTree(
  tree: SnapshotTree,
  paneIds: string[],
): PaneTree {
  if (tree.kind === "leaf") {
    return { kind: "leaf", paneId: paneIds[tree.pane] ?? paneIds[0] };
  }
  return {
    kind: "split",
    direction: tree.direction,
    ratio: tree.ratio,
    first: materializeTree(tree.first, paneIds),
    second: materializeTree(tree.second, paneIds),
  };
}

/** Leaf pane ids of a tree, left-to-right (stable across serialize/restore). */
export function collectTreePaneIds(tree: PaneTree): string[] {
  if (tree.kind === "leaf") return [tree.paneId];
  return [
    ...collectTreePaneIds(tree.first),
    ...collectTreePaneIds(tree.second),
  ];
}

/** Builds the persistable snapshot of the current tabs. */
export function buildSessionSnapshot(
  tabs: Tab[],
  claudePaneIds: ReadonlySet<string>,
  now: number,
): SessionSnapshot {
  return {
    savedAt: now,
    tabs: tabs.map((t) => {
      const order = collectTreePaneIds(t.tree);
      const indexOf = new Map(order.map((id, i) => [id, i]));
      return {
        projectId: t.projectId,
        tree: serializeTree(t.tree, indexOf),
        activePane: indexOf.get(t.activePaneId) ?? 0,
        panes: order.map((id) => ({
          paneId: id,
          cwd: t.panes[id]?.cwd ?? null,
          title: t.panes[id]?.title ?? "",
          wasClaude: claudePaneIds.has(id),
        })),
      };
    }),
  };
}

/** Validates a persisted value into a SessionSnapshot, or null. Shape-checks
 *  recursively so a corrupt store entry can never crash the restore path. */
export function normalizeSessionSnapshot(raw: unknown): SessionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.savedAt !== "number" || !Array.isArray(s.tabs)) return null;
  const tabs: SnapshotTab[] = [];
  for (const t of s.tabs) {
    const tab = t as Record<string, unknown>;
    if (typeof tab.projectId !== "string" || !Array.isArray(tab.panes)) {
      return null;
    }
    const panes: SnapshotPane[] = [];
    for (const p of tab.panes) {
      const pane = p as Record<string, unknown>;
      if (typeof pane.paneId !== "string") return null;
      panes.push({
        paneId: pane.paneId,
        cwd: typeof pane.cwd === "string" ? pane.cwd : null,
        title: typeof pane.title === "string" ? pane.title : "",
        wasClaude: pane.wasClaude === true,
      });
    }
    const tree = normalizeTree(tab.tree, panes.length);
    if (!tree || panes.length === 0) return null;
    tabs.push({
      projectId: tab.projectId,
      tree,
      activePane:
        typeof tab.activePane === "number" &&
        tab.activePane >= 0 &&
        tab.activePane < panes.length
          ? tab.activePane
          : 0,
      panes,
    });
  }
  return { savedAt: s.savedAt, tabs };
}

function normalizeTree(raw: unknown, paneCount: number): SnapshotTree | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "leaf") {
    return typeof t.pane === "number" && t.pane >= 0 && t.pane < paneCount
      ? { kind: "leaf", pane: t.pane }
      : null;
  }
  if (t.kind === "split") {
    const first = normalizeTree(t.first, paneCount);
    const second = normalizeTree(t.second, paneCount);
    if (!first || !second) return null;
    return {
      kind: "split",
      direction: t.direction === "vertical" ? "vertical" : "horizontal",
      ratio:
        typeof t.ratio === "number" && t.ratio > 0 && t.ratio < 1
          ? t.ratio
          : 0.5,
      first,
      second,
    };
  }
  return null;
}
