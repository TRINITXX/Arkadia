import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** A conversation shorter than this many screens needs no map. */
const MIN_SCREENS = 2;

/** What a mark stands for, in the map's words. */
const MARK_LABELS: Record<string, string> = {
  user: "Toi",
  claude: "Claude",
  question: "Question",
  visual: "Visuel",
  error: "Erreur",
};

interface Mark {
  kind: string;
  /** Its top, 0..1 of the column. */
  at: number;
  preview: string;
  el: HTMLElement;
}

/**
 * A map of the conversation on the column's right edge (the user's pick 12
 * of 01/11/2026): a tick per message, green the user's, violet Claude's
 * answers, orange its questions, blue its visuals, red its errors (the
 * units' `data-mark`), and the part on screen framed. Hovered, a tick says
 * what it is; clicked, the column goes there. Only for a conversation of a
 * few screens.
 */
export function ChatMinimap({
  scrollRef,
  innerRef,
  version,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  innerRef: React.RefObject<HTMLDivElement | null>;
  /** Changes when the column's items do: the marks are read again. */
  version: unknown;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [view, setView] = useState({ top: 0, height: 1, long: false });
  const [box, setBox] = useState({ top: 0, height: 0 });
  const [hover, setHover] = useState<Mark | null>(null);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const inner = innerRef.current;
    if (!scroller || !inner) return;
    // The part on screen, at each scroll: cheap.
    const readView = () => {
      const total = Math.max(1, scroller.scrollHeight);
      setView({
        top: scroller.scrollTop / total,
        height: scroller.clientHeight / total,
        long: total >= scroller.clientHeight * MIN_SCREENS,
      });
    };
    // The marks, when the column changes or resizes: each one's place in
    // the whole column, whatever is scrolled.
    const read = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        readView();
        const total = Math.max(1, scroller.scrollHeight);
        const origin =
          scroller.getBoundingClientRect().top - scroller.scrollTop;
        setBox({ top: scroller.offsetTop, height: scroller.clientHeight });
        setMarks(
          [...inner.querySelectorAll<HTMLElement>("[data-mark]")].map((el) => ({
            kind: el.dataset.mark ?? "claude",
            at: (el.getBoundingClientRect().top - origin) / total,
            preview: el.dataset.preview ?? "",
            el,
          })),
        );
      });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(scroller);
    observer.observe(inner);
    scroller.addEventListener("scroll", readView, { passive: true });
    return () => {
      cancelAnimationFrame(frame.current);
      observer.disconnect();
      scroller.removeEventListener("scroll", readView);
    };
  }, [scrollRef, innerRef, version]);

  // A tick gone from the column (a rewind) leaves no hover behind.
  useEffect(() => {
    if (hover && !hover.el.isConnected) setHover(null);
  }, [hover, marks]);

  if (!view.long || marks.length === 0) return null;
  const go = (mark: Mark) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    scroller.scrollTo({
      top: Math.max(0, mark.el.getBoundingClientRect().top - origin - 60),
      behavior: "smooth",
    });
  };
  return (
    <div
      className="chat-minimap"
      style={{ top: box.top + 12, height: Math.max(0, box.height - 24) }}
      aria-hidden
    >
      <div
        className="view"
        style={{ top: `${view.top * 100}%`, height: `${view.height * 100}%` }}
      />
      {marks.map((mark, i) => (
        <i
          key={i}
          className={mark.kind}
          style={{ top: `${mark.at * 100}%` }}
          onMouseEnter={() => setHover(mark)}
          onMouseLeave={() => setHover(null)}
          onClick={() => go(mark)}
        />
      ))}
      {hover && (
        <div
          className="peek"
          style={{
            top: `${hover.at * 100}%`,
            // Kept inside the map's height at its two ends.
            transform:
              hover.at < 0.1
                ? "none"
                : hover.at > 0.9
                  ? "translateY(-100%)"
                  : "translateY(-50%)",
          }}
        >
          <b className={hover.kind}>{MARK_LABELS[hover.kind] ?? ""}</b>
          {hover.preview && <span>{hover.preview}</span>}
        </div>
      )}
    </div>
  );
}
