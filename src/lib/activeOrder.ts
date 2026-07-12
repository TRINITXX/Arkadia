/**
 * Manual ordering of the sidepanel "Active" list.
 *
 * Each project may carry a persisted `activeOrder` (its manual position in the
 * Active tab). Projects the user never reordered have no `activeOrder` and sort
 * after every ordered one, alphabetically — so a freshly activated project lands
 * at the end of the list, and a reordered project keeps its relative place the
 * next time it becomes active.
 */

import type { Project } from "@/types";

/** Active-tab sort: manual position first (unordered → end), then name. */
export function sortActiveProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const ao = a.activeOrder ?? Infinity;
    const bo = b.activeOrder ?? Infinity;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Persists a drag-reorder of the Active list: projects listed in `orderedIds`
 * get `activeOrder = index`; every other project is left untouched (it keeps
 * its own `activeOrder`, or none).
 */
export function applyActiveReorder(
  projects: Project[],
  orderedIds: string[],
): Project[] {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  return projects.map((p) => {
    const r = rank.get(p.id);
    return r === undefined ? p : { ...p, activeOrder: r };
  });
}
