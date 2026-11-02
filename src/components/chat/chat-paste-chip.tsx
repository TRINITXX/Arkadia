import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList } from "lucide-react";

/** Room the hover needs above its tag; less, it opens below. */
const ROOM_ABOVE_PX = 300;
/** The pointer crossing the gap between the tag and its text keeps it open. */
const LEAVE_GRACE_MS = 150;

/** Where the text shows for its tag: above it if there is room, else below. */
function placeFor(tag: Element): React.CSSProperties {
  const r = tag.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 468));
  return r.top >= ROOM_ABOVE_PX
    ? { left, bottom: window.innerHeight - r.top + 6 }
    : { left, top: r.bottom + 6 };
}

/**
 * A text pasted as a tag, in the user's frame once sent (the user's pick 1
 * of 01/11/2026): the tag, its text on hover. The hover goes to the page's
 * top layer: a frame clips what overflows it (`content-visibility`). The
 * pointer may move onto the text, which scrolls when long (asked on
 * 02/11/2026): React counts the portal as the tag's child, so the tag's own
 * enter and leave cover both. The column scrolling under it (Claude writes)
 * moves it with its tag; a click, a key or a wheel outside it, or the tag
 * gone, closes it, never left behind.
 */
export function ChatPasteChip({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [at, setAt] = useState<React.CSSProperties | null>(null);
  const tagRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  const open = at !== null;
  const stay = () => window.clearTimeout(leaveTimer.current);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const inside = (e: Event) =>
      e.target instanceof Node && !!popRef.current?.contains(e.target);
    const close = (e: Event) => {
      // Its own scrolling, or a grab of its scrollbar: it stays.
      if (!inside(e)) setAt(null);
    };
    const follow = (e: Event) => {
      if (inside(e)) return;
      const tag = tagRef.current;
      if (!tag?.isConnected) return setAt(null);
      setAt(placeFor(tag));
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("wheel", close, opts);
    window.addEventListener("scroll", follow, opts);
    window.addEventListener("keydown", close, opts);
    window.addEventListener("pointerdown", close, opts);
    return () => {
      window.removeEventListener("wheel", close, opts);
      window.removeEventListener("scroll", follow, opts);
      window.removeEventListener("keydown", close, opts);
      window.removeEventListener("pointerdown", close, opts);
    };
  }, [open]);
  return (
    <span
      ref={tagRef}
      className="chat-paste-chip"
      onMouseEnter={(e) => {
        stay();
        setAt(placeFor(e.currentTarget));
      }}
      onMouseLeave={() => {
        stay();
        leaveTimer.current = window.setTimeout(
          () => setAt(null),
          LEAVE_GRACE_MS,
        );
      }}
    >
      <ClipboardList />
      {label}
      {at &&
        createPortal(
          <div ref={popRef} className="chat-paste-pop" style={at}>
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
