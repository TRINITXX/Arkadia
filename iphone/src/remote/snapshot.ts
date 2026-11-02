import type {
  RemoteBadge,
  RemotePane,
  RemoteProject,
  RemoteSnapshot,
  RemoteTab,
} from "@/lib/remoteSnapshot";

/** Every project, the sidebar's "Active" list first. */
export function allProjects(snapshot: RemoteSnapshot): RemoteProject[] {
  return [...snapshot.active, ...snapshot.groups.flatMap((g) => g.projects)];
}

export function findTab(
  snapshot: RemoteSnapshot,
  tabId: string,
): { project: RemoteProject; tab: RemoteTab } | null {
  for (const project of allProjects(snapshot)) {
    const tab = project.tabs.find((t) => t.id === tabId);
    if (tab) return { project, tab };
  }
  return null;
}

/** The desktop's badge colors: amber = Claude works, green = it waits for you. */
export function badgeColor(badge: RemoteBadge): string | null {
  if (badge === null) return null;
  return badge.startsWith("busy") ? "#ff9f0a" : "#30d158";
}

export type BadgeRing = "question" | "shell" | "artifact";

/** The desktop badge's rings, innermost first: Claude's questions wait, a
 *  shell runs while it waits, an artifact is open. `question` is undefined
 *  from a desktop built before 02/11/2026: no green ring then. */
export function badgeRings(badge: RemoteBadge, question: boolean): BadgeRing[] {
  if (badge === null) return [];
  const rings: BadgeRing[] = [];
  if (question) rings.push("question");
  if (badge.startsWith("waiting-shell")) rings.push("shell");
  if (badge.endsWith("-artifact")) rings.push("artifact");
  return rings;
}

/** A screen header's dot: the pane's own badge, else its tab's. */
export function headerBadge(
  tab: RemoteTab,
  pane: RemotePane | undefined,
): { badge: RemoteBadge; question: boolean } {
  const from = pane?.badge ? pane : tab;
  return { badge: from.badge, question: from.question };
}

/** "2 Minifashion" → "2": the accounts are numbered on the desktop. */
export function accountShortLabel(label: string): string {
  return label.split(" ")[0] ?? label;
}
