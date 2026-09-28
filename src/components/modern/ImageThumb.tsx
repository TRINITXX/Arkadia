import { memo, useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { fetchImageUrl } from "@/lib/imageUrlCache";

/** What the lightbox displays. */
export type LightboxContent =
  /** `path` places the image in the conversation gallery (arrow navigation). */
  { kind: "image"; url: string; path?: string } | { kind: "svg"; html: string };

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
        onOpen({ kind: "image", url, path });
      }}
    />
  );
});

/**
 * A path mentioned in prose, shown as the image itself. Until the bytes are
 * in (and forever, if the file isn't there) the original text stays put, so a
 * stale path never silently disappears from a message. Once the image is up,
 * the path shrinks to its file name and expands again on click.
 *
 * Every element is inline-level: this renders inside a `<p>`/`<li>`, where a
 * `<div>` would be invalid nesting.
 */
export const InlineImage = memo(function InlineImage({
  path,
  label,
  onOpen,
}: {
  path: string;
  /** The path as written in the message — the fallback, and the expanded form. */
  label: string;
  onOpen: (content: LightboxContent) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void fetchImageUrl(path).then((u) => {
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
  }, [path]);

  if (failed || !url) {
    return (
      <span ref={ref} className="modern-inline-pending">
        {label}
      </span>
    );
  }
  const name = path.split(/[\\/]/).pop() ?? path;
  return (
    <span className="modern-inline-img">
      <span
        className="cap"
        title={expanded ? "Réduire le chemin" : path}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        {expanded ? label : name}
      </span>
      <img
        src={url}
        alt={name}
        title={path}
        onClick={(e) => {
          e.stopPropagation();
          onOpen({ kind: "image", url, path });
        }}
      />
    </span>
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
