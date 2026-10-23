import { memo, useEffect, useRef, useState } from "react";
import { Film, Play } from "lucide-react";
import { backendInvoke } from "@/lib/bridge";
import {
  fetchVideoPoster,
  formatDuration,
  type VideoPoster,
} from "@/lib/videoPoster";
import type { LightboxContent } from "@/components/modern/ImageThumb";

/**
 * The poster of `path`, fetched only when the returned ref nears the viewport.
 * `undefined` while that is pending, `null` when there is no such file.
 */
function useLazyPoster<T extends Element>(path: string) {
  const ref = useRef<T>(null);
  const [poster, setPoster] = useState<VideoPoster | null | undefined>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void fetchVideoPoster(path).then((p) => {
          if (active) setPoster(p);
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

  return { ref, poster };
}

/**
 * A video shown as a still of itself, its file name and length in a band
 * over the picture. A click plays it in the lightbox; a file this view can't
 * decode shows a blank still and opens in the PC's own player instead.
 *
 * Inline-level elements only: the prose variant renders inside a `<p>`/`<li>`.
 */
function VideoFace({
  path,
  poster,
  caption,
  onOpen,
}: {
  path: string;
  poster: VideoPoster;
  caption?: string;
  onOpen: (content: LightboxContent) => void;
}) {
  const name = path.split(/[\\/]/).pop() ?? path;
  const playable = poster.url !== null;
  return (
    <span
      className="modern-video"
      title={playable ? path : `${path}\nOuvrir avec le lecteur vidéo du PC`}
      onClick={(e) => {
        e.stopPropagation();
        if (poster.url) {
          onOpen({ kind: "video", path, poster: poster.url, caption });
        } else {
          // The phone has no player of the PC to hand it to.
          void backendInvoke("open_path", { path }).catch(() => {});
        }
      }}
    >
      {poster.url ? (
        <img src={poster.url} alt={name} draggable={false} />
      ) : (
        <span className="blank">
          <Film size={26} />
        </span>
      )}
      <span className="band">
        <Play size={12} fill="currentColor" />
        <span className="name">{name}</span>
        {poster.duration !== undefined && (
          <small>{formatDuration(poster.duration)}</small>
        )}
      </span>
    </span>
  );
}

/**
 * A video path mentioned in prose. Until the file is found (and forever, if
 * it isn't there) the original text stays put, as for images.
 */
export const InlineVideo = memo(function InlineVideo({
  path,
  label,
  caption,
  onOpen,
}: {
  path: string;
  /** The path as written in the message, shown until the video is found. */
  label: string;
  /** The prose around the mention, shown above the video in the lightbox. */
  caption?: string;
  onOpen: (content: LightboxContent) => void;
}) {
  const { ref, poster } = useLazyPoster<HTMLSpanElement>(path);
  if (!poster) {
    return (
      <span ref={ref} className="modern-inline-pending">
        {label}
      </span>
    );
  }
  return (
    <VideoFace path={path} poster={poster} caption={caption} onOpen={onOpen} />
  );
});

/** A thumbnail strip's video: a placeholder until found, nothing if missing. */
export const VideoThumb = memo(function VideoThumb({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (content: LightboxContent) => void;
}) {
  const { ref, poster } = useLazyPoster<HTMLDivElement>(path);
  if (poster === null) return null;
  if (!poster) {
    return (
      <div ref={ref} className="modern-thumb-ph" title={path}>
        <Film size={18} />
      </div>
    );
  }
  return <VideoFace path={path} poster={poster} onOpen={onOpen} />;
});
