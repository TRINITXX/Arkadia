import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";

/** A conversation shorter than this many screens needs no map. */
const MIN_SCREENS = 2;
/** Narrower than this, the map would sit on the column: none. */
const MIN_PANE_PX = 640;
/** The marks are read again at most this often (a reply streams). */
const READ_EVERY_MS = 400;
/** A jump lands, then is checked once the units on the way drew. */
const SETTLE_MS = 450;

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

/** Where an element starts in the scroller's whole content. */
const topIn = (scroller: HTMLElement, el: HTMLElement) =>
  el.getBoundingClientRect().top -
  scroller.getBoundingClientRect().top +
  scroller.scrollTop;

/**
 * A map of the conversation on the column's right edge (the user's pick 12
 * of 01/11/2026): a tick per message, green the user's, violet Claude's
 * answers, orange its questions, blue its visuals, red its errors (the
 * units' `data-mark`), and the part on screen framed. Hovered, a tick says
 * what it is; clicked, the column goes there. Only for a conversation of a
 * few screens, in a pane wide enough. Light: the marks are read on a slow
 * clock, the frame alone follows the scroll.
 */
export const ChatMinimap = memo(function ChatMinimap({
  scrollRef,
  innerRef,
  version,
  onLeave,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  innerRef: React.RefObject<HTMLDivElement | null>;
  /** Changes when the column gets units (its item count): marks read again. */
  version: number;
  /** The column leaves its end: a jump is never pulled back down. */
  onLeave: () => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [view, setView] = useState({ top: 0, height: 1, long: false });
  const [box, setBox] = useState({ top: 0, height: 0 });
  const [hover, setHover] = useState<Mark | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const settle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settle.current), []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const inner = innerRef.current;
    if (!scroller || !inner) return;
    const wide = () => scroller.clientWidth >= MIN_PANE_PX;
    // The part on screen, at each scroll: cheap.
    const readView = () => {
      const total = Math.max(1, scroller.scrollHeight);
      setView({
        top: scroller.scrollTop / total,
        height: scroller.clientHeight / total,
        long: wide() && total >= scroller.clientHeight * MIN_SCREENS,
      });
    };
    // The marks: each one's place in the whole column. Never while the map
    // can't show (narrow pane).
    const readMarks = () => {
      readView();
      if (!wide()) return;
      const total = Math.max(1, scroller.scrollHeight);
      setBox({ top: scroller.offsetTop, height: scroller.clientHeight });
      setMarks(
        [...inner.querySelectorAll<HTMLElement>("[data-mark]")].map((el) => ({
          kind: el.dataset.mark ?? "claude",
          at: topIn(scroller, el) / total,
          preview: el.dataset.preview ?? "",
          el,
        })),
      );
    };
    const later = () => {
      if (timer.current !== undefined) return;
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        readMarks();
      }, READ_EVERY_MS);
    };
    readMarks();
    const observer = new ResizeObserver(later);
    observer.observe(scroller);
    observer.observe(inner);
    scroller.addEventListener("scroll", readView, { passive: true });
    return () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      observer.disconnect();
      scroller.removeEventListener("scroll", readView);
    };
  }, [scrollRef, innerRef, version]);

  // A tick gone (a rewind) or the map gone (a short chat again): no hover
  // left behind.
  useEffect(() => {
    if (hover && (!hover.el.isConnected || !view.long)) setHover(null);
  }, [hover, marks, view.long]);

  if (!view.long || marks.length === 0) return null;
  const go = (mark: Mark) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    onLeave();
    const land = (behavior: ScrollBehavior) =>
      scroller.scrollTo({
        top: Math.max(0, topIn(scroller, mark.el) - 60),
        behavior,
      });
    land("smooth");
    // The units crossed drew at their real size on the way: land again.
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      if (mark.el.isConnected) land("auto");
    }, SETTLE_MS);
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
});
