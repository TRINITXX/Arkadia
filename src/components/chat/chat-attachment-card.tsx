import { useRef } from "react";
import { File, Film, Folder, Image as ImageIcon, X } from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { openPath, type ToastFn } from "@/components/modern/MarkdownContent";
import { fileName } from "@/lib/chat/chatAttachments";
import { VideoThumb } from "@/components/modern/VideoThumb";
import { usePathImage } from "@/lib/chat/usePathImage";
import { isImagePath, isVideoPath } from "@/lib/imagePaths";

/** What a card shows: an image pasted (in memory) or a file by its path. */
export type AttachmentSource =
  | {
      kind: "pasted";
      key: string;
      url: string;
      name: string;
      /** A sent message's: the lightbox walks the conversation from it. A
       *  draft's is in no message yet. */
      inGallery?: boolean;
    }
  | {
      kind: "path";
      key: string;
      path: string;
      /** Named in a sentence, not attached: a thumbnail once the file is
       *  found, nothing otherwise (the match may run over words). */
      quiet?: boolean;
    };

/** A selection drag ends in a click: it selected, never opened. */
const selecting = () => !!window.getSelection()?.toString();

/**
 * One attachment, above the input or in the user's frame: an image as its
 * thumbnail (the lightbox on click), any other file as a dark card with its
 * icon and name (opened by its app on click). An image that can't be read
 * falls back to the file card. × (on hover) removes it from the input.
 */
export function ChatAttachmentCard(props: {
  source: AttachmentSource;
  onOpen: (content: LightboxContent) => void;
  onRemove?: () => void;
  onToast?: ToastFn;
}) {
  const { source, onOpen } = props;
  // A video named in a sentence: its still, as the reading view shows it.
  if (source.kind === "path" && source.quiet && isVideoPath(source.path))
    return <VideoThumb path={source.path} onOpen={onOpen} />;
  return <AttachmentCard {...props} />;
}

function AttachmentCard({
  source,
  onOpen,
  onRemove,
  onToast,
}: {
  source: AttachmentSource;
  onOpen: (content: LightboxContent) => void;
  onRemove?: () => void;
  onToast?: ToastFn;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const path = source.kind === "path" ? source.path : null;
  const video = !!path && isVideoPath(path);
  const image = !path || isImagePath(path);
  const read = usePathImage(ref, path && image ? path : null);
  const url = source.kind === "pasted" ? source.url : read.url;
  const name = source.kind === "pasted" ? source.name : fileName(source.path);
  const thumb = image && !read.failed;
  // No extension: a folder, most likely.
  const Icon = video ? Film : /\.[^.\\/]+$/.test(name) ? File : Folder;

  const open = () => {
    if (thumb && url) {
      const walk = source.kind === "path" || source.inGallery;
      onOpen({ kind: "image", url, path: walk ? (path ?? name) : undefined });
    } else if (video && path) onOpen({ kind: "video", path });
    else if (path) openPath(path, onToast);
  };
  if (source.kind === "path" && source.quiet && read.failed) return null;
  return (
    <div
      ref={ref}
      className={`chat-file${thumb ? ` thumb${url ? "" : " loading"}` : ""}`}
      title={path ?? name}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        if (!selecting()) open();
      }}
      onKeyDown={(e) => {
        // Enter on its × is the ×'s.
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        open();
      }}
    >
      {thumb ? (
        url ? (
          <img src={url} alt={name} draggable={false} />
        ) : (
          <ImageIcon className="ph" />
        )
      ) : (
        <>
          <span className="well">
            <Icon className="ic" />
          </span>
          <span className="nm">{name}</span>
        </>
      )}
      {onRemove && (
        <button
          type="button"
          className="x"
          title="Retirer"
          aria-label={`Retirer ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X />
        </button>
      )}
    </div>
  );
}
