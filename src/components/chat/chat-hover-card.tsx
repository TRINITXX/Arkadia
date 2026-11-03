import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChatLayer } from "@/lib/chat/useChatLayers";

/** The card's tallest, when the window has room for it. */
const MAX_PX = 360;
/** The gap between the icon and its card, and the window's edge it keeps off. */
const GAP_PX = 6;
const EDGE_PX = 8;
/**
 * The pointer rests this long on the icon before its card shows: one
 * crossing it on the way up the conversation opens nothing (the user's ask
 * of 03/11/2026). A click shows it at once.
 */
const HOVER_DELAY_MS = 500;

/**
 * Where the card goes: above its icon when there's room for its tallest,
 * else on the side with the more room, its height capped to that room (a
 * fixed cap ran past the window's top).
 */
function cardPlace(icon: DOMRect, width: number): React.CSSProperties {
  const w = Math.min(width, window.innerWidth - 2 * EDGE_PX);
  const left = Math.max(
    EDGE_PX,
    Math.min(icon.right - w, window.innerWidth - w - EDGE_PX),
  );
  const above = icon.top - GAP_PX - EDGE_PX;
  const below = window.innerHeight - icon.bottom - GAP_PX - EDGE_PX;
  const up = above >= MAX_PX || above >= below;
  const maxHeight = Math.max(0, Math.min(MAX_PX, up ? above : below));
  return up
    ? {
        left,
        width: w,
        maxHeight,
        bottom: window.innerHeight - icon.top + GAP_PX,
      }
    : { left, width: w, maxHeight, top: icon.bottom + GAP_PX };
}

/**
 * A small icon on Claude's reply with what it hides in a card (« Récit », the
 * user's picks of 02/11/2026): hovered half a second, the card shows in the
 * page's top layer (a frame clips what overflows it); clicked, it stays and scrolls,
 * until a click or a wheel elsewhere, or Esc (a layer of the pane: never
 * Claude stopped with it). The column moving, even on its own as Claude
 * writes, carries the card along with its icon; the icon gone out of
 * sight, the card goes. Its content is drawn only while it shows.
 */
export function ChatHoverCard({
  icon,
  label,
  width,
  content,
}: {
  icon: React.ReactNode;
  label: string;
  /** The card's width (px), within the window's. */
  width: number;
  content: () => React.ReactNode;
}) {
  const [at, setAt] = useState<React.CSSProperties | null>(null);
  const [pinned, setPinned] = useState(false);
  const [cut, setCut] = useState(false);
  const iconRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const place = () => {
    const button = iconRef.current;
    if (button) setAt(cardPlace(button.getBoundingClientRect(), width));
  };
  // The card on its way while the pointer rests on the icon.
  const pending = useRef<number | undefined>(undefined);
  const cancelHover = () => {
    window.clearTimeout(pending.current);
    pending.current = undefined;
  };
  useEffect(() => () => window.clearTimeout(pending.current), []);
  const placeLater = () => {
    cancelHover();
    pending.current = window.setTimeout(() => {
      pending.current = undefined;
      place();
    }, HOVER_DELAY_MS);
  };
  const close = () => {
    cancelHover();
    setAt(null);
    setPinned(false);
  };
  useChatLayer(at !== null, close);
  // Cut or not, measured once drawn: a cut card fades out at its foot.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card) setCut(card.scrollHeight > card.clientHeight + 1);
  }, [at]);
  const shown = at !== null;
  useEffect(() => {
    if (!shown) return;
    const inside = (e: Event) =>
      e.target instanceof Node &&
      Boolean(
        cardRef.current?.contains(e.target) ||
        iconRef.current?.contains(e.target),
      );
    // Only the user's own gestures elsewhere close it.
    const onOutside = (e: Event) => {
      if (pinned && !inside(e)) close();
    };
    // A scroll of what holds the icon (the column following its end too):
    // the card follows, and goes once the icon is out of sight. Other
    // elements' scrolls (another pane, the card's own) aren't its business.
    const onScroll = (e: Event) => {
      const button = iconRef.current;
      if (!button || !(e.target instanceof Node)) return;
      if (e.target !== document && !e.target.contains(button)) return;
      const r = button.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) close();
      else place();
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onOutside, opts);
    window.addEventListener("wheel", onOutside, opts);
    window.addEventListener("scroll", onScroll, opts);
    return () => {
      window.removeEventListener("pointerdown", onOutside, opts);
      window.removeEventListener("wheel", onOutside, opts);
      window.removeEventListener("scroll", onScroll, opts);
    };
    // `place` and `close` only set state: the latest render's are the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, pinned]);
  return (
    <button
      ref={iconRef}
      type="button"
      className={`chat-peek${at ? " on" : ""}`}
      // No `title`: the browser's tooltip would come with the card, after
      // the same half second, and stay over it.
      aria-label={label}
      aria-expanded={pinned}
      onMouseEnter={() => {
        if (!pinned) placeLater();
      }}
      // The conversation still scrolling under the pointer: the wait starts over.
      onWheel={() => {
        if (pending.current !== undefined) placeLater();
      }}
      onMouseLeave={() => {
        cancelHover();
        if (!pinned) setAt(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (pinned) close();
        else {
          cancelHover();
          place();
          setPinned(true);
        }
      }}
    >
      {icon}
      {at &&
        createPortal(
          <div
            ref={cardRef}
            className={`chat-peek-card${pinned ? " pinned" : ""}${cut && !pinned ? " cut" : ""}`}
            style={at}
            // Its clicks reach the icon through the portal: they'd close it.
            onClick={(e) => e.stopPropagation()}
            // Focus on one of its buttons is out of the pane, whose Esc
            // ignores it: the card answers Esc itself.
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              close();
              iconRef.current?.focus();
            }}
          >
            {content()}
          </div>,
          document.body,
        )}
    </button>
  );
}
