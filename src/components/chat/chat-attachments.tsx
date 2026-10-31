import { Images } from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import {
  ChatAttachmentCard,
  type AttachmentSource,
} from "@/components/chat/chat-attachment-card";

/**
 * A row of attachment cards (`ChatAttachmentCard`): above the input, with
 * × to remove each, or in the user's frame, where `dropped` counts pasted
 * images no longer in memory (`keepPasted`).
 */
export function ChatAttachments({
  sources,
  dropped = 0,
  onOpen,
  onRemove,
  onToast,
}: {
  sources: AttachmentSource[];
  dropped?: number;
  onOpen: (content: LightboxContent) => void;
  /** By the card's key; absent in a message. */
  onRemove?: (key: string) => void;
  onToast?: ToastFn;
}) {
  if (sources.length === 0 && dropped === 0) return null;
  return (
    <div className="chat-files">
      {dropped > 0 && (
        <span
          className="chat-gallery-more"
          title="Collées plus tôt : seules les dernières images collées restent en mémoire"
        >
          <Images /> {dropped} image{dropped > 1 ? "s" : ""}
        </span>
      )}
      {sources.map((source) => (
        <ChatAttachmentCard
          key={source.key}
          source={source}
          onOpen={onOpen}
          onRemove={onRemove && (() => onRemove(source.key))}
          onToast={onToast}
        />
      ))}
    </div>
  );
}
