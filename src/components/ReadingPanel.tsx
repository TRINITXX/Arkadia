import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import {
  CONVERSATION_CSS,
  ConversationMessages,
  useConversation,
} from "@/components/ConversationView";
import type { TerminalPalette } from "@/types";

const PANEL_W_DEFAULT = 480;
const PANEL_W_MIN = 340;
const PANEL_W_MAX = 920;

interface ReadingPanelProps {
  /** Active pane = the Claude session whose transcript we read. */
  paneId: string | null;
  projectName: string | null;
  palette: TerminalPalette;
  onClose: () => void;
}

export function ReadingPanel({
  paneId,
  projectName,
  palette,
  onClose,
}: ReadingPanelProps) {
  const [width, setWidth] = useState(PANEL_W_DEFAULT);
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const { messages, error, refresh } = useConversation(paneId);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the conversation only when already pinned near the bottom, so reading
  // older messages isn't interrupted by a live refresh.
  const atBottomRef = useRef(true);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    let last = startWidth;
    // Resize the panel via the DOM during the drag — committing to React state
    // on every mousemove would re-render the whole (markdown-heavy) message list
    // each pixel and stutter badly. State is synced once, on mouse-up.
    const onMove = (ev: MouseEvent) => {
      last = Math.max(
        PANEL_W_MIN,
        Math.min(PANEL_W_MAX, startWidth + (startX - ev.clientX)),
      );
      if (rootRef.current) rootRef.current.style.width = `${last}px`;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setWidth(last);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={rootRef}
      style={{
        width,
        backgroundColor: palette.bg,
        color: palette.fg,
        boxShadow: "-12px 0 36px -16px rgba(0,0,0,0.7)",
      }}
      className="reading-root absolute inset-y-0 right-0 z-30 flex flex-col border-l border-zinc-800"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <style>{CONVERSATION_CSS}</style>
      <div
        onMouseDown={onResizeStart}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-zinc-700"
      />
      <div
        className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800 px-3"
        style={{ backgroundColor: palette.bg }}
      >
        <span className="text-xs font-medium text-zinc-200">Lecture</span>
        <span className="flex-1 truncate text-xs text-zinc-500">
          {projectName ?? ""}
        </span>
        <button
          onClick={refresh}
          className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          title="Rafraîchir"
          aria-label="Rafraîchir"
          type="button"
        >
          <RefreshCw size={13} />
        </button>
        <button
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          title="Fermer"
          aria-label="Fermer la lecture"
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      {!paneId ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-zinc-600">
          aucun terminal actif
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-zinc-600">
          conversation pas encore détectée — envoie un message (ou relance
          Claude) dans ce terminal, puis rouvre la lecture
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-zinc-600">
          {"aucun message pour l'instant"}
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          <ConversationMessages messages={messages} />
        </div>
      )}
    </div>
  );
}
