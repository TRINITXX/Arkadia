import type { Project } from "../types";

/** Normalise a Windows path for comparison: lowercase, forward slashes, no trailing sep. */
function norm(pathStr: string): string {
  return pathStr.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Every project whose path matches (case/separator-insensitive). Plural because
 *  repeated adds can leave duplicates the remove flow must clear in one pass. */
export function findProjectsByPath(
  projects: Project[],
  path: string,
): Project[] {
  const target = norm(path);
  return projects.filter((p) => norm(p.path) === target);
}

export function findProjectByPath(
  projects: Project[],
  path: string,
): Project | undefined {
  return findProjectsByPath(projects, path)[0];
}

/** The existing project that is a sibling of `worktreePath` (same parent dir).
 *  Used to inherit color/workspace so worktrees cluster under their repo. */
export function parentOf(
  projects: Project[],
  worktreePath: string,
): Project | undefined {
  const parentDir = norm(worktreePath).split("/").slice(0, -1).join("/");
  return projects
    .filter((p) => norm(p.path).split("/").slice(0, -1).join("/") === parentDir)
    .sort((a, b) => b.path.length - a.path.length)[0];
}
