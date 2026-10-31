import { useRef, type ReactNode } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { fileName } from "@/lib/chat/chatAttachments";
import { usePathImage } from "@/lib/chat/usePathImage";

/**
 * An image Claude read, small in its tool line, in place of its path; the
 * lightbox on click (the line itself stays folded). `fallback` (its name)
 * shows while it loads and if it can't be read.
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
  if (failed)
    return fallback && <span className="chat-read-alt">{fallback}</span>;
  if (!url && fallback)
    return (
      <span ref={ref} className="chat-read-alt">
        {fallback}
      </span>
    );
  return (
    <span ref={ref} className="chat-read-thumb" title={path}>
      {url && (
        <img
          src={url}
          alt={fileName(path)}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            onOpen({ kind: "image", url, path });
          }}
        />
      )}
    </span>
  );
}
