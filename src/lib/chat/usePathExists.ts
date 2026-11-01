import { useEffect, useState, type RefObject } from "react";
import { backendInvoke } from "@/lib/bridge";

/** Paths probed, by path: a file found stays found. */
const probes = new Map<string, Promise<boolean>>();
/** The newest kept. */
const KEPT = 500;
/** A path not found yet may be written soon (a capture, a report): asked again after this. */
const MISS_KEPT_MS = 10_000;

/** True when the file or folder exists (`path_exists`), asked once a while. */
export function pathExists(path: string): Promise<boolean> {
  const cached = probes.get(path);
  if (cached) return cached;
  const probe = backendInvoke<boolean>("path_exists", { path }).catch(
    () => false,
  );
  probes.set(path, probe);
  while (probes.size > KEPT)
    probes.delete(probes.keys().next().value as string);
  void probe.then((found) => {
    if (!found)
      window.setTimeout(() => {
        if (probes.get(path) === probe) probes.delete(path);
      }, MISS_KEPT_MS);
  });
  return probe;
}

/**
 * Whether `path` exists, asked once `ref`'s element nears the view (as
 * `usePathImage`): null until known. A null `path` asks nothing.
 */
export function usePathExists(
  ref: RefObject<Element | null>,
  path: string | null,
): boolean | null {
  const [known, setKnown] = useState<{ path: string; found: boolean } | null>(
    null,
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || !path) return;
    let active = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void pathExists(path).then((found) => {
          if (active) setKnown({ path, found });
        });
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      active = false;
      io.disconnect();
    };
  }, [ref, path]);
  return known && known.path === path ? known.found : null;
}
