import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchImageUrl } from "@/lib/imageUrlCache";

/** Viewport box (CSS px) of the hovered path the preview hangs from. */
export interface PreviewAnchor {
  left: number;
  top: number;
  bottom: number;
}

interface PreviewState {
  path: string;
  url: string;
  anchor: PreviewAnchor;
}

/** Hover this long before the preview shows: sweeping the mouse must not flash images. */
const SHOW_DELAY_MS = 250;
/** Grace to travel from the path onto the preview without it vanishing. */
const HIDE_DELAY_MS = 200;
/** Medium size: big enough to read small UI text, never the whole window. */
const MAX_WIDTH_PX = 860;
const MAX_HEIGHT_PX = 720;
const GAP_PX = 6;
const MARGIN_PX = 12;

/**
 * Hover preview of an image path, driven imperatively from the terminal's
 * window-level hover loop: `hover` is fed the hovered image path (or null) on
 * every evaluation, `keep` holds the preview while the pointer sits on it.
 * The returned `api` is stable, so long-lived listener closures can hold it.
 */
export function useImageHoverPreview() {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const elRef = useRef<HTMLDivElement>(null);

  // Timers, the path the pointer currently asks for (null = none) and the one
  // shown. Mutable, read only from the api's callbacks.
  const st = useRef<{
    showTimer: number | null;
    hideTimer: number | null;
    wanted: string | null;
    shown: string | null;
  }>({ showTimer: null, hideTimer: null, wanted: null, shown: null });

  const api = useMemo(() => {
    const clearShow = () => {
      if (st.current.showTimer !== null)
        window.clearTimeout(st.current.showTimer);
      st.current.showTimer = null;
    };
    const clearHide = () => {
      if (st.current.hideTimer !== null)
        window.clearTimeout(st.current.hideTimer);
      st.current.hideTimer = null;
    };
    const hide = () => {
      clearShow();
      clearHide();
      st.current.wanted = null;
      st.current.shown = null;
      setPreview(null);
    };

    return {
      hover(path: string | null, anchor?: PreviewAnchor) {
        const cur = st.current;
        if (path !== null && path === cur.wanted) {
          clearHide();
          return;
        }
        if (path === null || !anchor) {
          clearShow();
          cur.wanted = null;
          if (cur.shown !== null && cur.hideTimer === null) {
            cur.hideTimer = window.setTimeout(hide, HIDE_DELAY_MS);
          }
          return;
        }
        clearShow();
        clearHide();
        cur.wanted = path;
        cur.shown = null;
        setPreview(null);
        cur.showTimer = window.setTimeout(() => {
          cur.showTimer = null;
          void fetchImageUrl(path).then((url) => {
            if (cur.wanted !== path || !url) return;
            cur.shown = path;
            setPreview({ path, url, anchor });
          });
        }, SHOW_DELAY_MS);
      },
      /** Pointer entered the preview: cancel the pending hide. */
      keep() {
        clearHide();
        st.current.wanted = st.current.shown;
      },
      hide,
    };
  }, []);

  useEffect(() => api.hide, [api]);

  return { preview, api, elRef };
}

interface ImageHoverPreviewProps {
  preview: PreviewState;
  elRef: React.RefObject<HTMLDivElement>;
  onEnter: () => void;
  onOpen: (path: string) => void;
}

/**
 * The floating preview card, under the path (or above it when there is more
 * room there). Portaled to `body` so no pane ancestor clips or offsets it.
 */
export function ImageHoverPreview({
  preview,
  elRef,
  onEnter,
  onOpen,
}: ImageHoverPreviewProps) {
  const { anchor } = preview;
  const roomBelow = window.innerHeight - anchor.bottom - GAP_PX - MARGIN_PX;
  const roomAbove = anchor.top - GAP_PX - MARGIN_PX;
  const below = roomBelow >= roomAbove;
  const maxHeight = Math.min(MAX_HEIGHT_PX, below ? roomBelow : roomAbove);
  const maxWidth = Math.min(
    MAX_WIDTH_PX,
    window.innerWidth * 0.6,
    window.innerWidth - 2 * MARGIN_PX,
  );

  // The width is only known once the image is decoded: on every size change,
  // slide the card left from the path just enough to stay in the window.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const fit = () => {
      const maxLeft = window.innerWidth - MARGIN_PX - el.offsetWidth;
      el.style.left = `${Math.max(MARGIN_PX, Math.min(anchor.left, maxLeft))}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor.left, elRef, preview.url]);

  const name = preview.path.split(/[\\/]/).pop() ?? preview.path;

  return createPortal(
    <div
      ref={elRef}
      onMouseEnter={onEnter}
      onClick={() => onOpen(preview.path)}
      title="Cliquer pour agrandir"
      style={{
        position: "fixed",
        left: anchor.left,
        // Its own width, not what is left right of `left` (shrink-to-fit
        // would squeeze it against the edge before `fit` can move it).
        width: "max-content",
        ...(below
          ? { top: anchor.bottom + GAP_PX }
          : { bottom: window.innerHeight - anchor.top + GAP_PX }),
        zIndex: 40,
        padding: 4,
        background: "rgba(20,20,24,0.96)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 8,
        boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
        cursor: "zoom-in",
        animation: "img-preview-in .12s ease-out both",
      }}
    >
      <style>
        {
          "@keyframes img-preview-in { from { opacity: 0; } to { opacity: 1; } }"
        }
      </style>
      <img
        src={preview.url}
        alt=""
        draggable={false}
        style={{
          display: "block",
          maxWidth,
          maxHeight: Math.max(120, maxHeight - 26),
          borderRadius: 5,
        }}
      />
      <div
        style={{
          maxWidth,
          padding: "4px 2px 0",
          fontSize: 11,
          color: "#8a9099",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </div>
    </div>,
    document.body,
  );
}
