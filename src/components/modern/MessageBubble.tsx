import { memo, useMemo, useState } from "react";
import { Brain, Check, Copy, Sparkles, User } from "lucide-react";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import {
  ThumbStrip,
  type LightboxContent,
} from "@/components/modern/ImageThumb";
import { messageStripImages } from "@/lib/imageGallery";
import { CLAUDE_TINT, USER_TINT, hexToRgba } from "@/lib/messageTint";
import { messageTime, messageTimeFull } from "@/lib/messageTime";
import type { ConvBlock } from "@/components/ModernConversationView";

const ROLE: Record<string, { tint: string; label: string; Icon: typeof User }> =
  {
    user: { tint: USER_TINT, label: "Toi", Icon: User },
    assistant: { tint: CLAUDE_TINT, label: "Claude", Icon: Sparkles },
    thinking: { tint: "#6b7280", label: "Réflexion", Icon: Brain },
  };

/** Hover-revealed button that copies a message's markdown to the clipboard. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="modern-copy"
      title="Copier le message"
      aria-label="Copier le message"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {});
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

interface MessageBubbleProps {
  block: ConvBlock;
  /** The session's working directory, for relative image paths. */
  baseDir?: string | null;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}

/** A user / assistant / thinking bubble: role header, markdown body, images. */
export const MessageBubble = memo(function MessageBubble({
  block,
  baseDir,
  onOpen,
  onToast,
}: MessageBubbleProps) {
  const role = ROLE[block.kind] ?? ROLE.assistant;
  const text = block.text ?? "";
  const sentAt = messageTime(block.ts);

  // Pasted images (and paths left verbatim in a fence): the other mentions
  // render as images inside the markdown, where they are written.
  const thumbs = useMemo(
    () => messageStripImages(block, baseDir),
    [block, baseDir],
  );

  return (
    <div
      className="modern-msg"
      style={{
        borderColor: hexToRgba(role.tint, 0.25),
        borderLeftColor: hexToRgba(role.tint, 0.75),
        background: hexToRgba(role.tint, 0.04),
      }}
    >
      <div className="modern-msg-head">
        <span className="role-ico" style={{ color: role.tint }}>
          <role.Icon size={13} />
        </span>
        <span className="role-lbl" style={{ color: hexToRgba(role.tint, 0.9) }}>
          {role.label}
        </span>
        {sentAt && (
          <span
            className="role-time"
            title={messageTimeFull(block.ts) ?? undefined}
          >
            {sentAt}
          </span>
        )}
        <CopyButton text={text} />
      </div>
      {text && (
        <div
          className="reading-md modern-msg-body"
          style={
            block.kind === "thinking"
              ? { fontStyle: "italic", opacity: 0.85 }
              : undefined
          }
        >
          <MarkdownContent
            text={text}
            baseDir={baseDir}
            onOpen={onOpen}
            onToast={onToast}
          />
        </div>
      )}
      <ThumbStrip paths={thumbs} onOpen={onOpen} />
    </div>
  );
});
