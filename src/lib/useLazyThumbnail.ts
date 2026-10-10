import { useEffect, useState, type RefObject } from "react";
import { fetchThumbnailUrl } from "@/lib/imageUrlCache";

/** How far below the scrolled-to edge a placeholder starts loading: ~2 rows. */
const AHEAD = "200px";
/**
 * How long a placeholder scrolled into range must stay there before its
 * thumbnail is asked for. Each one costs the backend a decode, or an
 * ImageMagick run, that cannot be called off once started: a fling past
 * hundreds of rows must not queue one per row.
 */
const DWELL_MS = 120;

/**
 * The backend thumbnail of an on-disk still, fetched only once `ref` nears the
 * visible part of `root`. A list scrolled through a few hundred photos then
 * generates thumbnails for the rows the user stops on, not for all of them.
 * A placeholder already on screen when it mounts loads at once, so opening the
 * list never waits on the dwell.
 *
 * `enabled: false` (a download that isn't an image) skips the fetch entirely.
 * `failed` is set once the backend could not produce one.
 */
export function useLazyThumbnail(
  ref: RefObject<HTMLElement | null>,
  root: RefObject<HTMLElement | null>,
  path: string,
  mtime: number,
  enabled = true,
): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let active = true;
    let mounting = true;
    let timer: number | null = null;
    // Inside the scroller's visible part, not merely in the margin ahead of it:
    // a page appended mid-fling mounts below the fold and must wait its turn.
    const onScreen = (box: DOMRectReadOnly) => {
      const view = root.current?.getBoundingClientRect();
      return (
        box.bottom > (view?.top ?? 0) &&
        box.top < (view?.bottom ?? window.innerHeight)
      );
    };
    const load = () => {
      io.disconnect();
      void fetchThumbnailUrl(path, mtime).then((u) => {
        if (!active) return;
        if (u) setUrl(u);
        else setFailed(true);
      });
    };
    const io = new IntersectionObserver(
      (entries) => {
        // Records arrive in order: the last one is where the element is now.
        const entry = entries[entries.length - 1];
        const first = mounting;
        mounting = false;
        if (!entry.isIntersecting) {
          if (timer !== null) window.clearTimeout(timer);
          timer = null;
        } else if (first && onScreen(entry.boundingClientRect)) {
          load();
        } else if (timer === null) {
          timer = window.setTimeout(load, DWELL_MS);
        }
      },
      { root: root.current, rootMargin: AHEAD },
    );
    io.observe(el);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      io.disconnect();
    };
  }, [ref, root, path, mtime, enabled]);

  return { url, failed };
}
