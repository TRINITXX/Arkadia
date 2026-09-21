import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { ImageRef } from "@/lib/imageGallery";
import { fetchImageUrl } from "@/lib/imageUrlCache";
import { IDENTITY_VIEW, zoomAt, type ZoomView } from "@/lib/zoomPan";

interface LightboxProps {
  content: LightboxContent;
  /** Every image of the conversation, in reading order, for ←/→ navigation. */
  gallery: ImageRef[];
  onClose: () => void;
}

/** A pointer move past this many pixels is a pan, not a click. */
const DRAG_THRESHOLD = 4;

/** Cursor position relative to the centre of `stage`. */
function fromCentre(
  stage: HTMLElement,
  clientX: number,
  clientY: number,
): [number, number] {
  const r = stage.getBoundingClientRect();
  return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2];
}

/**
 * Full-screen zoom overlay for images and mermaid SVGs. Follows the app's
 * overlay idiom (fixed inset-0, no portal). Keyboard is captured on `window`
 * while open so Escape (and anything else) never leaks into the focused
 * terminal's PTY.
 *
 * Wheel zooms around the cursor, drag pans once zoomed, double-click toggles
 * a 2.5× zoom. An image that belongs to the gallery steps through it with the
 * arrow keys or the side buttons, skipping paths that no longer load.
 */
export function Lightbox({ content, gallery, onClose }: LightboxProps) {
  const [image, setImage] = useState(
    content.kind === "image" ? { url: content.url, path: content.path } : null,
  );
  const [view, setView] = useState<ZoomView>(IDENTITY_VIEW);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    origin: ZoomView;
    moved: boolean;
  } | null>(null);
  // Set by a pan so the click that ends it neither closes nor zooms.
  const suppressClick = useRef(false);
  // Only the latest navigation may land (a slow fetch must not win late).
  const navToken = useRef(0);

  // Looked up each render: a live conversation keeps appending to the gallery.
  const index = image?.path
    ? gallery.findIndex(
        (g) => g.path.toLowerCase() === image.path!.toLowerCase(),
      )
    : -1;
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < gallery.length - 1;

  const step = useCallback(
    (dir: 1 | -1) => {
      if (index < 0) return;
      const token = ++navToken.current;
      const tryAt = (i: number) => {
        if (i < 0 || i >= gallery.length) return;
        const ref = gallery[i];
        void fetchImageUrl(ref.path, ref.mediaType).then((url) => {
          if (token !== navToken.current) return;
          if (!url) {
            tryAt(i + dir);
            return;
          }
          setImage({ url, path: ref.path });
          setView(IDENTITY_VIEW);
        });
      };
      tryAt(index + dir);
    },
    [gallery, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, step]);

  // Native listener: React's onWheel is passive, and the wheel must not scroll
  // anything behind the overlay.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = fromCentre(el, e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => zoomAt(v, factor, px, py));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // A pan whose closing click never came must not eat this new click.
    suppressClick.current = false;
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: view,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || view.scale <= 1) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragging(true);
      stageRef.current?.setPointerCapture(e.pointerId);
    }
    setView({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved) suppressClick.current = true;
    drag.current = null;
    setDragging(false);
  };

  const onStageClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // Only the backdrop closes; a click on the content itself does nothing.
    if (e.target === e.currentTarget) onClose();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const [px, py] = fromCentre(stage, e.clientX, e.clientY);
    setView((v) => (v.scale > 1 ? IDENTITY_VIEW : zoomAt(v, 2.5, px, py)));
  };

  const zoomed = view.scale > 1;
  const contentCursor = dragging ? "grabbing" : zoomed ? "grab" : "zoom-in";

  return (
    <div
      ref={stageRef}
      className="modern-lightbox"
      style={dragging ? { cursor: "grabbing" } : undefined}
      onClick={onStageClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* The transform lives on a wrapper: the pop animation on the content
          animates `transform` too, and a CSS animation beats inline styles. */}
      <div
        className="lb-zoom"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          // Follow the wheel instantly; ease only the double-click jumps.
          transition: dragging ? "none" : "transform .08s ease-out",
        }}
      >
        {image ? (
          <img
            key={image.url}
            src={image.url}
            alt=""
            draggable={false}
            onClick={(e) => {
              if (!suppressClick.current) e.stopPropagation();
            }}
            onDoubleClick={onDoubleClick}
            style={{ cursor: contentCursor }}
          />
        ) : content.kind === "svg" ? (
          <div
            className="svgbox"
            onClick={(e) => {
              if (!suppressClick.current) e.stopPropagation();
            }}
            onDoubleClick={onDoubleClick}
            style={{ cursor: contentCursor }}
            dangerouslySetInnerHTML={{ __html: content.html }}
          />
        ) : null}
      </div>
      {hasPrev && (
        <button
          type="button"
          className="lb-nav prev"
          title="Image précédente (←)"
          aria-label="Image précédente"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            step(-1);
          }}
        >
          <ChevronLeft size={22} />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          className="lb-nav next"
          title="Image suivante (→)"
          aria-label="Image suivante"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            step(1);
          }}
        >
          <ChevronRight size={22} />
        </button>
      )}
    </div>
  );
}
