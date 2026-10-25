import type {
  RemoteBadge,
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

/** "2 Minifashion" → "2": the accounts are numbered on the desktop. */
export function accountShortLabel(label: string): string {
  return label.split(" ")[0] ?? label;
}
