/**
 * The iPhone Live Activity's rows: one per tab Alexis drives from the phone,
 * in the sidebar's order, with its project and title (Alexis's request of
 * 25/10/2026) and its state: `w` = Claude waits for him, `b` = it works,
 * `i` = neither. Mirrors src-tauri `remote::activity::rows`, which pushes the
 * same rows to the activity once the app is in the background.
 */

import type { RemoteSnapshot } from "@/lib/remoteSnapshot";

export interface FollowRow {
  /** `w` | `b` | `i`. */
  s: string;
  /** Project name. */
  p: string;
  /** Tab title. */
  t: string;
}

export function followRows(
  snapshot: RemoteSnapshot,
  followed: ReadonlySet<string>,
): FollowRow[] {
  const projects = [
    ...snapshot.active,
    ...snapshot.groups.flatMap((g) => g.projects),
  ];
  const rows: FollowRow[] = [];
  for (const project of projects)
    for (const tab of project.tabs) {
      if (!tab.panes.some((p) => followed.has(p.id))) continue;
      const s = tab.badge?.startsWith("busy")
        ? "b"
        : tab.badge?.startsWith("waiting")
          ? "w"
          : "i";
      rows.push({ s, p: project.name, t: tab.title });
    }
  return rows;
}
