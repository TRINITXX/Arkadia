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
import { findImagePaths } from "@/lib/imagePaths";
import { CLAUDE_TINT, USER_TINT, hexToRgba } from "@/lib/messageTint";
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
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}

/** A user / assistant / thinking bubble: role header, markdown body, images. */
export const MessageBubble = memo(function MessageBubble({
  block,
  onOpen,
  onToast,
}: MessageBubbleProps) {
  const role = ROLE[block.kind] ?? ROLE.assistant;
  const text = block.text ?? "";

  // Transcript images (pasted) + on-disk image paths mentioned in the text.
  const thumbs = useMemo(() => {
    const out: { path: string; mediaType?: string }[] = (
      block.images ?? []
    ).map((img) => ({ path: img.path, mediaType: img.media_type }));
    if (out.length === 0 && text) {
      for (const path of findImagePaths(text)) out.push({ path });
    }
    return out;
  }, [block.images, text]);

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
          <MarkdownContent text={text} onOpen={onOpen} onToast={onToast} />
        </div>
      )}
      <ThumbStrip paths={thumbs} onOpen={onOpen} />
    </div>
  );
});
