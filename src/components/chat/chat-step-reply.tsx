import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatReplyText } from "@/components/chat/chat-reply-text";
import type { ImageRef } from "@/lib/imageGallery";

const NO_IMAGES: ImageRef[] = [];

/**
 * A reply of Claude's that says what it does next (`stepReplyIds`): a
 * sentence of the story, its thinking and tools behind small icons
 * (« Récit », the user's picks of 02/11/2026). In full ink while its
 * exchange runs, dim after.
 */
export function ChatStepReply({
  text,
  bare,
  past,
  peeks,
  cwd,
  onOpen,
  onToast,
}: {
  text: string;
  bare: boolean;
  /** Said before the exchange under way: before the user's last message taken. */
  past: boolean;
  /** Its icons: the bulb of its thinking, the wrench of its tools. */
  peeks: React.ReactNode;
  cwd: string | null;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  return (
    <div className={`chat-unit chat-step-reply${past ? " past" : ""}`}>
      <ChatReplyText
        text={text}
        bare={bare}
        cwd={cwd}
        refs={NO_IMAGES}
        onOpen={onOpen}
        onToast={onToast}
      />
      {peeks && <span className="chat-peeks">{peeks}</span>}
    </div>
  );
}
