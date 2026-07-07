import type { Entries } from "@/lib/durableStore";

/**
 * Health predicate for the main `store.json` durable backup ring.
 *
 * A snapshot is "healthy" (trustworthy, worth keeping in the ring and worth
 * loading as-is) once the app has INITIALIZED the store — i.e. it carries a
 * `projects` array. The array being EMPTY is a perfectly valid user state
 * (they deleted every project) and must persist across launches.
 *
 * The only unhealthy state is a store with no `projects` key at all: the
 * `@tauri-apps/plugin-store` crate swallows a corrupt/torn file and starts from
 * a completely empty cache (no keys), so "no projects key" is exactly the
 * crash-wiped case that should trigger a restore from backup.
 *
 * Keying off `length > 0` instead conflated "user deleted everything" with
 * "crash wiped the file": an intentional full delete was refused by the write-
 * gate and then resurrected from an old backup on the next launch. The wire key
 * "projects" mirrors `KEY_PROJECTS` in `store.ts` (a stable persisted name).
 */
export function storeIsHealthy(entries: Entries): boolean {
  const projects = entries.find(([k]) => k === "projects")?.[1];
  return Array.isArray(projects);
}
