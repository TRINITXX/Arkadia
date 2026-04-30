import type { PaneTree, SplitDirection } from "@/types";

export function collectPaneIds(tree: PaneTree): string[] {
  if (tree.kind === "leaf") return [tree.paneId];
  return [...collectPaneIds(tree.first), ...collectPaneIds(tree.second)];
}

export function countPanes(tree: PaneTree): number {
  if (tree.kind === "leaf") return 1;
  return countPanes(tree.first) + countPanes(tree.second);
}

export function splitTreeAt(
  tree: PaneTree,
  targetPaneId: string,
  direction: SplitDirection,
  newPaneId: string,
): PaneTree {
  if (tree.kind === "leaf") {
    if (tree.paneId !== targetPaneId) return tree;
    return {
      kind: "split",
      direction,
      ratio: 0.5,
      first: tree,
      second: { kind: "leaf", paneId: newPaneId },
    };
  }
  return {
    ...tree,
    first: splitTreeAt(tree.first, targetPaneId, direction, newPaneId),
    second: splitTreeAt(tree.second, targetPaneId, direction, newPaneId),
  };
}

/** Returns null if the only remaining pane was removed (caller should close the tab). */
export function removePaneFromTree(
  tree: PaneTree,
  paneId: string,
): PaneTree | null {
  if (tree.kind === "leaf") {
    return tree.paneId === paneId ? null : tree;
  }
  const first = removePaneFromTree(tree.first, paneId);
  const second = removePaneFromTree(tree.second, paneId);
  if (first === null && second === null) return null;
  if (first === null) return second;
  if (second === null) return first;
  return { ...tree, first, second };
}

export function updateTreeRatio(
  tree: PaneTree,
  path: number[],
  ratio: number,
): PaneTree {
  if (tree.kind !== "split") return tree;
  if (path.length === 0) {
    return { ...tree, ratio };
  }
  const [head, ...rest] = path;
  if (head === 0) {
    return { ...tree, first: updateTreeRatio(tree.first, rest, ratio) };
  }
  return { ...tree, second: updateTreeRatio(tree.second, rest, ratio) };
}

/** Find the first leaf paneId reachable from this subtree (used to pick a new active pane after close). */
export function firstPaneId(tree: PaneTree): string {
  if (tree.kind === "leaf") return tree.paneId;
  return firstPaneId(tree.first);
}
