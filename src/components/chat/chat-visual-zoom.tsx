import { createPortal } from "react-dom";
import { Shapes, SquareArrowOutUpRight, X } from "lucide-react";
import { ChatVisualFrame } from "@/components/chat/chat-visual-frame";
import { useChatLayer } from "@/lib/chat/useChatLayers";

interface ChatVisualZoomProps {
  html: string;
  title: string;
  /** The chat pane (`.chat-root`): the view covers it, not the whole app. */
  host: HTMLElement;
  onClose: () => void;
  onChoose?: (text: string) => void;
  onLink?: (url: string) => void;
  onOpenInBrowser?: () => void;
}

/**
 * « Agrandir »: the visual over the whole chat pane, its page scrolling
 * inside. Esc (from the pane) or « Fermer » brings the column back.
 */
export function ChatVisualZoom({
  html,
  title,
  host,
  onClose,
  onChoose,
  onLink,
  onOpenInBrowser,
}: ChatVisualZoomProps) {
  useChatLayer(true, onClose);
  return createPortal(
    <div className="chat-visual-zoom" role="dialog" aria-label={title}>
      <div className="chat-visual-head">
        <Shapes />
        <span className="t">{title}</span>
        <span className="tail">
          {onOpenInBrowser && (
            <button
              type="button"
              className="chat-visual-btn"
              onClick={onOpenInBrowser}
            >
              <SquareArrowOutUpRight />
              <span className="lbl">Ouvrir dans le navigateur</span>
            </button>
          )}
          <button type="button" className="chat-visual-btn" onClick={onClose}>
            <X />
            <span className="lbl">Fermer</span>
          </button>
        </span>
      </div>
      <div className="chat-visual-zoom-body">
        <ChatVisualFrame
          html={html}
          title={title}
          fill
          onChoose={(text) => {
            onChoose?.(text);
            onClose();
          }}
          onLink={onLink}
        />
      </div>
    </div>,
    host,
  );
}
