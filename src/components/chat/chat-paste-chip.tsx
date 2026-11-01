import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList } from "lucide-react";

/** Room the hover needs above its tag; less, it opens below. */
const ROOM_ABOVE_PX = 300;

/**
 * A text pasted as a tag, in the user's frame once sent (the user's pick 1
 * of 01/11/2026): the tag, its text on hover. The hover goes to the page's
 * top layer: a frame clips what overflows it (`content-visibility`). A
 * click, a key, a wheel or the tag gone closes it, never left behind.
 */
export function ChatPasteChip({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [at, setAt] = useState<React.CSSProperties | null>(null);
  const open = at !== null;
  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("wheel", close, opts);
    window.addEventListener("scroll", close, opts);
    window.addEventListener("keydown", close, opts);
    window.addEventListener("pointerdown", close, opts);
    return () => {
      window.removeEventListener("wheel", close, opts);
      window.removeEventListener("scroll", close, opts);
      window.removeEventListener("keydown", close, opts);
      window.removeEventListener("pointerdown", close, opts);
    };
  }, [open]);
  return (
    <span
      className="chat-paste-chip"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const left = Math.max(8, Math.min(r.left, window.innerWidth - 468));
        setAt(
          r.top >= ROOM_ABOVE_PX
            ? { left, bottom: window.innerHeight - r.top + 6 }
            : { left, top: r.bottom + 6 },
        );
      }}
      onMouseLeave={() => setAt(null)}
    >
      <ClipboardList />
      {label}
      {at &&
        createPortal(
          <div className="chat-paste-pop" style={at}>
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
