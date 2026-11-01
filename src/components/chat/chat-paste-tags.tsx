import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pasteSpans, wordCount, type PastedText } from "@/lib/chat/chatPastes";
import { useChatLayer } from "@/lib/chat/useChatLayers";

/** Keeps a last empty line its height in the twin, as in the input. */
const ZERO_WIDTH = "​";

/** The pointer crosses from a tag to its hover within this. */
const CLOSE_AFTER_MS = 150;

/** The input's styles the twin copies, so its text lies exactly under it. */
const COPIED = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "tabSize",
] as const;

/**
 * The tags of the texts pasted in the input (`chatPastes`), drawn as chips
 * under its transparent text by a twin of it that lies exactly behind, its
 * own text invisible. A tag hovered shows its text, editable there, with
 * « Mettre le texte » to put it back in place (the user's pick A of
 * 01/11/2026).
 */
export function ChatPasteTags({
  areaRef,
  text,
  pastes,
  onEdit,
  onUnfold,
  trailing,
}: {
  areaRef: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  pastes: readonly PastedText[];
  onEdit: (id: number, next: string) => void;
  onUnfold: (id: number) => void;
  /** Dictated words not landed yet, in grey after the text, in place. */
  trailing?: string;
}) {
  const twinRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    id: number;
    left: number;
    top: number;
  } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const popRef = useRef<HTMLDivElement>(null);
  // Typing in its field keeps it open: the pointer may wander meanwhile.
  const editing = () => !!popRef.current?.contains(document.activeElement);
  // Esc closes it, never Claude's turn (`chatLayers`).
  useChatLayer(hover !== null, () => setHover(null));
  const spans = pasteSpans(text, pastes);
  const on = spans.length > 0 || !!trailing;

  // The twin on the input's box, its styles and its scroll.
  useLayoutEffect(() => {
    const area = areaRef.current;
    const twin = twinRef.current;
    if (!on || !area || !twin) return;
    const place = () => {
      const style = window.getComputedStyle(area);
      for (const k of COPIED) twin.style[k] = style[k];
      twin.style.left = `${area.offsetLeft}px`;
      twin.style.top = `${area.offsetTop}px`;
      // Its text's width: the input's scrollbar, once it has one, aside.
      twin.style.width = `${area.clientWidth}px`;
      twin.style.height = `${area.offsetHeight}px`;
      twin.scrollTop = area.scrollTop;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(area);
    area.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      area.removeEventListener("scroll", place);
    };
  }, [on, text, areaRef]);

  // The tag under the pointer: the input sits above the twin, so its own
  // moves are read against the tags' boxes.
  useEffect(() => {
    const area = areaRef.current;
    const twin = twinRef.current;
    if (!on || !area || !twin) return;
    const box = () => area.closest(".chat-box")?.getBoundingClientRect();
    const onMove = (e: MouseEvent) => {
      // Typing in a tag's hover: it stays on that tag, wherever the pointer goes.
      if (editing()) return;
      for (const mark of twin.querySelectorAll<HTMLElement>("mark")) {
        for (const r of mark.getClientRects()) {
          if (
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          ) {
            const b = box();
            if (!b) return;
            window.clearTimeout(timer.current);
            setHover({
              id: Number(mark.dataset.id),
              // Kept inside the input's box.
              left: Math.max(8, Math.min(r.left - b.left, b.width - 452)),
              top: r.top - b.top,
            });
            return;
          }
        }
      }
      leave();
    };
    const leave = () => {
      if (editing()) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setHover(null), CLOSE_AFTER_MS);
    };
    area.addEventListener("mousemove", onMove);
    area.addEventListener("mouseleave", leave);
    return () => {
      area.removeEventListener("mousemove", onMove);
      area.removeEventListener("mouseleave", leave);
    };
  }, [areaRef, on]);

  if (!on) return null;
  const shown = hover && pastes.find((p) => p.id === hover.id);
  let at = 0;
  const parts: React.ReactNode[] = [];
  for (const s of spans) {
    parts.push(text.slice(at, s.start));
    parts.push(
      <mark key={s.start} data-id={s.paste.id}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    at = s.end;
  }
  parts.push(text.slice(at));
  if (trailing)
    parts.push(
      <span key="interim" className="interim">
        {text && !/\s$/.test(text) ? " " : ""}
        {trailing}
      </span>,
    );
  // A last line break still takes a line, as in the input.
  parts.push(ZERO_WIDTH);
  return (
    <>
      <div className="chat-paste-twin" ref={twinRef} aria-hidden>
        {parts}
      </div>
      {shown && hover && (
        <div
          className="chat-paste-hover"
          ref={popRef}
          style={{
            left: hover.left,
            bottom: `calc(100% - ${hover.top}px + 6px)`,
          }}
          onMouseEnter={() => window.clearTimeout(timer.current)}
          onMouseLeave={() => {
            if (!editing()) setHover(null);
          }}
        >
          <textarea
            value={shown.text}
            aria-label="Texte collé"
            spellCheck={false}
            onChange={(e) => onEdit(shown.id, e.target.value)}
            // Done typing: it closes, unless the focus stays in it (its button).
            onBlur={(e) => {
              if (!popRef.current?.contains(e.relatedTarget as Node | null))
                setHover(null);
            }}
          />
          <div className="ft">
            <span>
              {wordCount(shown.text)} mot{wordCount(shown.text) > 1 ? "s" : ""}{" "}
              · modifiable ici
            </span>
            <button
              type="button"
              onClick={() => {
                setHover(null);
                onUnfold(shown.id);
              }}
            >
              Mettre le texte
            </button>
          </div>
        </div>
      )}
    </>
  );
}
