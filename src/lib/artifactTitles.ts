import { useSyncExternalStore } from "react";

/**
 * The titles of the claude.ai artifacts the panel showed (its page's own
 * title), by artifact id, kept in the webview's storage: a chat's artifact
 * card names the artifact (« Visibilité dans les IA ») instead of its id
 * (the user's ask of 01/11/2026). An artifact Claude publishes opens in the
 * panel at once, so its title is known from then on.
 */

const KEY = "arkadia.artifactTitles.v1";
/** The newest kept: the storage is small and shared by the page. */
const KEPT = 300;

/** The artifact's id in a claude.ai link, or null. */
export function artifactId(url: string): string | null {
  return /\/artifact\/([^/?#]+)/.exec(url)?.[1] ?? null;
}

function load(): Map<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object")
      return new Map(
        Object.entries(parsed).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      );
  } catch {
    // Storage blocked or torn: no titles, the ids show.
  }
  return new Map();
}

let titles: Map<string, string> | null = null;
const listeners = new Set<() => void>();

const all = () => (titles ??= load());

/** A title the panel read for this link (a generic « Claude » ignored). */
export function rememberArtifactTitle(url: string, title: string): void {
  const id = artifactId(url);
  const t = title.trim();
  if (!id || !t || t === "Claude" || all().get(id) === t) return;
  const map = all();
  map.delete(id);
  map.set(id, t);
  while (map.size > KEPT) map.delete(map.keys().next().value as string);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Full or blocked: known for this run only.
  }
  for (const cb of listeners) cb();
}

/** The title known for this link, or null. */
export function useArtifactTitle(url: string): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      const id = artifactId(url);
      return id ? (all().get(id) ?? null) : null;
    },
  );
}
