import { useEffect, useRef, useState } from "react";
import { clampVisualHeight } from "@/lib/chat/chatVisual";
import { frameGestureNow, loadVisualFrame } from "@/lib/chat/chatVisualDom";

interface ChatVisualFrameProps {
  /** The page, its local images in (`ChatState.visuals`). */
  html: string;
  title: string;
  /** Fills its box (« Agrandir ») instead of fitting the page's height. */
  fill?: boolean;
  /** A choice of the page (`arkadia.choose`), on the user's click in it. */
  onChoose?: (text: string) => void;
  /** A link of the page, on the user's click: the browser opens it. */
  onLink?: (url: string) => void;
}

/** Height before the page says its own (`size`). */
const FIRST_HEIGHT = 160;

/**
 * A visual's sandboxed frame (`loadVisualFrame`): its height follows the
 * page up to `VISUAL_MAX_HEIGHT`, then the page scrolls inside. A new page
 * gets a new frame, never the old one's state.
 */
export function ChatVisualFrame({
  html,
  title,
  fill = false,
  onChoose,
  onLink,
}: ChatVisualFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const handlers = useRef({ onChoose, onLink });
  useEffect(() => {
    handlers.current = { onChoose, onLink };
  });
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const iframe = document.createElement("iframe");
    iframe.title = title;
    box.appendChild(iframe);
    const stop = loadVisualFrame(iframe, html, (m) => {
      if (m.kind === "size") setHeight(clampVisualHeight(m.height));
      // Only the user's click in this frame acts (`frameGestureOk`).
      else if (m.kind === "choose" && frameGestureNow(iframe))
        handlers.current.onChoose?.(m.text);
      else if (m.kind === "link" && frameGestureNow(iframe))
        handlers.current.onLink?.(m.url);
    });
    return () => {
      stop();
      iframe.remove();
    };
  }, [html, title]);
  return (
    <div
      ref={boxRef}
      className="chat-visual-box"
      style={fill ? undefined : { height: height ?? FIRST_HEIGHT }}
    />
  );
}
