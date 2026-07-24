import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Image as ImageIcon } from "lucide-react";

/** What the lightbox displays. */
export type LightboxContent =
  | { kind: "image"; url: string }
  | { kind: "svg"; html: string };

const MIME_FOR_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

// Module-level cache path → object URL (or null for a failed probe), LRU-ish
// capped: oldest entries revoked when full. Failures are cached too, so a
// non-existent path mentioned in prose is probed exactly once.
const urlCache = new Map<string, Promise<string | null>>();
const URL_CACHE_MAX = 80;

function fetchImageUrl(
  path: string,
  mediaType?: string,
): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  const promise = invoke<ArrayBuffer>("read_image_bytes", { path })
    .then((buf) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const type = mediaType ?? MIME_FOR_EXT[ext] ?? "image/png";
      return URL.createObjectURL(new Blob([buf], { type }));
    })
    .catch(() => null);
  if (urlCache.size >= URL_CACHE_MAX) {
    const [oldestKey, oldest] = urlCache.entries().next().value!;
    urlCache.delete(oldestKey);
    void oldest.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  urlCache.set(path, promise);
  return promise;
}

interface ImageThumbProps {
  path: string;
  mediaType?: string;
  onOpen: (content: LightboxContent) => void;
}

/**
 * A lazily-loaded image thumbnail: the bytes are fetched over IPC only when
 * the placeholder nears the viewport (works with `content-visibility` — the
 * observer fires on the estimated box). A failed fetch (missing file, not an
 * image) renders nothing.
 */
export const ImageThumb = memo(function ImageThumb({
  path,
  mediaType,
  onOpen,
}: ImageThumbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void fetchImageUrl(path, mediaType).then((u) => {
          if (!active) return;
          if (u) setUrl(u);
          else setFailed(true);
        });
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      active = false;
      io.disconnect();
    };
  }, [path, mediaType]);

  if (failed) return null;
  if (!url) {
    return (
      <div ref={ref} className="modern-thumb-ph" title={path}>
        <ImageIcon size={18} />
      </div>
    );
  }
  return (
    <img
      className="modern-thumb"
      src={url}
      alt={path}
      title={path}
      onClick={(e) => {
        e.stopPropagation();
        onOpen({ kind: "image", url });
      }}
    />
  );
});

/** A wrapping strip of thumbnails; renders nothing for an empty list. */
export function ThumbStrip({
  paths,
  onOpen,
}: {
  paths: { path: string; mediaType?: string }[];
  onOpen: (content: LightboxContent) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <div className="modern-thumbs">
      {paths.map((p) => (
        <ImageThumb
          key={p.path}
          path={p.path}
          mediaType={p.mediaType}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
