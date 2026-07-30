import { memo, useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { fetchImageUrl } from "@/lib/imageUrlCache";

/** What the lightbox displays. */
export type LightboxContent =
  | { kind: "image"; url: string }
  | { kind: "svg"; html: string };

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
