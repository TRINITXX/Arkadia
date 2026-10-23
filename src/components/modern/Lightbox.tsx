import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LIGHTBOX_CSS } from "@/components/modern/css";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { ImageRef } from "@/lib/imageGallery";
import { fetchImageUrl } from "@/lib/imageUrlCache";
import { IDENTITY_VIEW, zoomAt, type ZoomView } from "@/lib/zoomPan";
import { useOverlay } from "@/lib/overlays";

interface LightboxProps {
  content: LightboxContent;
  /** Every image of the conversation, in reading order, for ←/→ navigation. */
  gallery: ImageRef[];
  onClose: () => void;
}

/** A pointer move past this many pixels is a pan, not a click. */
const DRAG_THRESHOLD = 4;

/**
 * Cursor position relative to the centre of the zoom layer as laid out,
 * before its transform (`offset*` ignore transforms). The caption above the
 * image moves that centre off the stage's.
 */
function fromCentre(
  stage: HTMLElement,
  layer: HTMLElement,
  clientX: number,
  clientY: number,
): [number, number] {
  const r = stage.getBoundingClientRect();
  return [
    clientX - r.left - layer.offsetLeft - layer.offsetWidth / 2,
    clientY - r.top - layer.offsetTop - layer.offsetHeight / 2,
  ];
}

/** Whether a mouse drag just selected text: its closing click is no click. */
function hasSelection(): boolean {
  const sel = window.getSelection();
  return sel !== null && !sel.isCollapsed;
}

/**
 * Full-screen zoom overlay for images and mermaid SVGs. Follows the app's
 * overlay idiom (fixed inset-0, no portal). Keyboard is captured on `window`
 * while open so Escape (and anything else) never leaks into the focused
 * terminal's PTY.
 *
 * Wheel zooms around the cursor, drag pans once zoomed, double-click toggles
 * a 2.5× zoom. An image that belongs to the gallery steps through it with the
 * arrow keys or the side buttons, skipping paths that no longer load. Above
 * an image sit the prose its message wrote around it and its file name, which
 * expands to the full path on click.
 */
export function Lightbox({ content, gallery, onClose }: LightboxProps) {
  // The artifact page steps aside while this layer is open.
  useOverlay();
  // `caption` is the clicked mention's; a step clears it for the gallery's.
  const [image, setImage] = useState<{
    url: string;
    path?: string;
    caption?: string;
  } | null>(
    content.kind === "image"
      ? { url: content.url, path: content.path, caption: content.caption }
      : null,
  );
  const [view, setView] = useState<ZoomView>(IDENTITY_VIEW);
  const [dragging, setDragging] = useState(false);
  const [pathExpanded, setPathExpanded] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
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
  const caption =
    image?.caption ?? (index >= 0 ? gallery[index].caption : undefined);
  const captionShown = Boolean(image?.path);

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
          setPathExpanded(false);
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

  // The image gives up the caption's height so both fit on screen. Written
  // straight to the stage: the observer fires before paint, a re-render would
  // show one frame of overlap.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const cap = captionRef.current;
    if (!stage || !cap) return;
    const ro = new ResizeObserver(() =>
      stage.style.setProperty("--lb-cap", `${cap.offsetHeight}px`),
    );
    ro.observe(cap);
    return () => {
      ro.disconnect();
      stage.style.removeProperty("--lb-cap");
    };
  }, [captionShown]);

  // Native listener: React's onWheel is passive, and the wheel must not scroll
  // anything behind the overlay.
  useEffect(() => {
    const el = stageRef.current;
    const layer = zoomRef.current;
    if (!el || !layer) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = fromCentre(el, layer, e.clientX, e.clientY);
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
    // Only the backdrop closes; a click on the content itself does nothing,
    // nor does the one that ends a caption selection out on the backdrop.
    if (e.target === e.currentTarget && !hasSelection()) onClose();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const stage = stageRef.current;
    const layer = zoomRef.current;
    if (!stage || !layer) return;
    const [px, py] = fromCentre(stage, layer, e.clientX, e.clientY);
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
      <style>{LIGHTBOX_CSS}</style>
      {image?.path && (
        <div
          ref={captionRef}
          className="lb-cap"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {caption && (
            <div className="txt" title={caption}>
              {caption}
            </div>
          )}
          <div
            className={`path${pathExpanded ? " open" : ""}`}
            title={pathExpanded ? "Réduire le chemin" : image.path}
            onClick={() => {
              // Selecting the path to copy it must not fold it back.
              if (!hasSelection()) setPathExpanded((v) => !v);
            }}
          >
            {pathExpanded
              ? image.path
              : (image.path.split(/[\\/]/).pop() ?? image.path)}
          </div>
        </div>
      )}
      {/* The transform lives on a wrapper: the pop animation on the content
          animates `transform` too, and a CSS animation beats inline styles. */}
      <div
        ref={zoomRef}
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
