import { useMemo } from "react";
import { ChatReadThumb } from "@/components/chat/chat-read-thumb";
import { fileName } from "@/lib/chat/chatAttachments";
import type { ToolItem } from "@/lib/chat/chatGroups";
import { lineImagePaths, readImagePath } from "@/lib/chat/chatImages";
import { useChatLightbox } from "@/lib/chat/chatLightbox";

/**
 * Thumbnails of the images Claude read in these calls (`Read` of an image
 * file), the latest ones, in their tool line in place of their paths:
 * « 1 fichier lu · lit [capture] ».
 */
export function ChatReadThumbs({ tools }: { tools: ToolItem[] }) {
  const paths = useMemo(() => lineImagePaths(tools, readImagePath), [tools]);
  return <ChatThumbStrip paths={paths} />;
}

/**
 * Small thumbnails of image files on a line. Each one's name shows while
 * it loads and if it can't be read, unless `imagesOnly`: on a reply's line,
 * four names would squeeze its sentence, an image gone shows nothing. A
 * click opens the chat's lightbox.
 */
export function ChatThumbStrip({
  paths,
  imagesOnly = false,
}: {
  paths: string[];
  imagesOnly?: boolean;
}) {
  const onOpen = useChatLightbox();
  if (paths.length === 0) return null;
  return (
    <span className="chat-read-thumbs">
      {paths.map((path) =>
        onOpen ? (
          <ChatReadThumb
            key={path}
            path={path}
            onOpen={onOpen}
            fallback={imagesOnly ? null : fileName(path)}
          />
        ) : imagesOnly ? null : (
          <span key={path} className="chat-read-alt">
            {fileName(path)}
          </span>
        ),
      )}
    </span>
  );
}
