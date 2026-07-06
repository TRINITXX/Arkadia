import type { Project } from "../types";

/** Normalise a Windows path for comparison: lowercase, forward slashes, no trailing sep. */
function norm(pathStr: string): string {
  return pathStr.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function findProjectByPath(
  projects: Project[],
  path: string,
): Project | undefined {
  const target = norm(path);
  return projects.find((p) => norm(p.path) === target);
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
