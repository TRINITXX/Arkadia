import { useEffect, useRef, type ReactNode } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { fileName } from "@/lib/chat/chatAttachments";
import { usePathImage } from "@/lib/chat/usePathImage";
import { usePathHover } from "@/lib/pathHover";

/**
 * An image Claude read, small in its tool line, in place of its path; a
 * bigger one in a card while hovered (`PathHoverContext`, as an image path
 * of the prose), the lightbox on click (the line itself stays folded).
 * `fallback` (its name) shows while it loads and if it can't be read.
 */
export function ChatReadThumb({
  path,
  onOpen,
  fallback = null,
}: {
  path: string;
  onOpen: (content: LightboxContent) => void;
  fallback?: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { url, failed } = usePathImage(ref, path);
  const hover = usePathHover();
  // Hovered when it goes (the line redrawn) or changes path: no mouseleave
  // will come, its card goes now.
  const hovered = useRef(false);
  useEffect(
    () => () => {
      if (hovered.current) hover?.hover(null);
      hovered.current = false;
    },
    [hover, path],
  );
  const leave = () => {
    hovered.current = false;
    hover?.hover(null);
  };
  if (failed)
    return fallback && <span className="chat-read-alt">{fallback}</span>;
  if (!url && fallback)
    return (
      <span ref={ref} className="chat-read-alt">
        {fallback}
      </span>
    );
  return (
    <span
      ref={ref}
      className="chat-read-thumb"
      title={hover ? undefined : path}
    >
      {url && (
        <img
          src={url}
          alt={fileName(path)}
          draggable={false}
          onMouseEnter={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            hovered.current = true;
            hover?.hover(path, {
              left: box.left,
              top: box.top,
              bottom: box.bottom,
            });
          }}
          onMouseLeave={leave}
          onClick={(e) => {
            e.stopPropagation();
            leave();
            onOpen({ kind: "image", url, path });
          }}
        />
      )}
    </span>
  );
}
