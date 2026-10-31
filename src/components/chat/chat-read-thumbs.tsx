import { useMemo } from "react";
import { ChatReadThumb } from "@/components/chat/chat-read-thumb";
import { fileName } from "@/lib/chat/chatAttachments";
import type { ToolItem } from "@/lib/chat/chatGroups";
import { readImagePath } from "@/lib/chat/chatImages";
import { useChatLightbox } from "@/lib/chat/chatLightbox";
import { imagePathKey } from "@/lib/imagePaths";

/** A line shows at most this many of the images read. */
const MAX_THUMBS = 4;

/**
 * Thumbnails of the images Claude read in these calls (`Read` of an image
 * file), the latest ones, in their tool line in place of their paths:
 * « 1 fichier lu · lit [capture] ». Each one's name shows while it loads
 * and if it can't be read. A click opens the chat's lightbox.
 */
export function ChatReadThumbs({ tools }: { tools: ToolItem[] }) {
  const onOpen = useChatLightbox();
  const paths = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = tools.length - 1; i >= 0; i--) {
      const path = readImagePath(tools[i]);
      if (!path || seen.has(imagePathKey(path))) continue;
      seen.add(imagePathKey(path));
      if (out.unshift(path) >= MAX_THUMBS) break;
    }
    return out;
  }, [tools]);
  if (paths.length === 0) return null;
  return (
    <span className="chat-read-thumbs">
      {paths.map((path) =>
        onOpen ? (
          <ChatReadThumb
            key={path}
            path={path}
            onOpen={onOpen}
            fallback={fileName(path)}
          />
        ) : (
          <span key={path} className="chat-read-alt">
            {fileName(path)}
          </span>
        ),
      )}
    </span>
  );
}
