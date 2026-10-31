import { useEffect, useState, type RefObject } from "react";
import { fetchImageUrl } from "@/lib/imageUrlCache";

/**
 * An image file's bytes as a URL, fetched once `ref`'s element nears the
 * view (as `ImageThumb`). `failed`: no such file, or not an image. A null
 * `path` fetches nothing.
 */
export function usePathImage(
  ref: RefObject<Element | null>,
  path: string | null,
): { url: string | null; failed: boolean } {
  const [loaded, setLoaded] = useState<{
    path: string;
    url: string | null;
  } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !path) return;
    let active = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void fetchImageUrl(path).then((url) => {
          if (active) setLoaded({ path, url });
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

  // A card reused for another path shows nothing of the previous one.
  const mine = loaded && loaded.path === path ? loaded : null;
  return { url: mine?.url ?? null, failed: !!mine && !mine.url };
}
