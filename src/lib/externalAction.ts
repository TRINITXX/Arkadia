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

/**
 * Collapse projects sharing a normalized path down to the first one. Repeated
 * non-idempotent `/w` adds (from a build before the idempotency guard landed)
 * could stack several projects onto the same worktree path, which made them
 * impossible to remove — deleting one by id left its identical twins, so the
 * project "came back". Run on load so any such history self-heals; a no-op once
 * paths are unique. Empty paths are never collapsed (degenerate, kept as-is).
 */
export function dedupeProjectsByPath(projects: Project[]): Project[] {
  const seen = new Set<string>();
  const out: Project[] = [];
  for (const p of projects) {
    const key = norm(p.path);
    if (key !== "" && seen.has(key)) continue;
    if (key !== "") seen.add(key);
    out.push(p);
  }
  return out;
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
