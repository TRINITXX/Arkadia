import { useLayoutEffect, useRef } from "react";
import { followsAfterScroll, placeAfterResize } from "@/lib/followBottom";

/**
 * A scroller kept at its end while its content grows: a subagent's sheet,
 * followed as the agent works. Only the reader scrolling up leaves the end,
 * and coming back down to it follows again (`followsAfterScroll`, as the
 * chat's column). `fromEnd`: opened at its end (an agent still running), else
 * at its start, to be read from the top. A hidden tab sizes its pane to
 * nothing and the scroll falls to 0: back on screen, the reader's place is
 * put back (REVIEW.md, « Place de la colonne d'un chat »).
 */
export function useFollowEnd(fromEnd: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(fromEnd);
  /** `scrollTop` at the last scroll event or stick. */
  const lastTopRef = useRef(0);
  /** The place last read while the scroller had a size. */
  const savedTopRef = useRef(0);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const inner = innerRef.current;
    if (!scroller || !inner) return;
    let wasHidden = scroller.clientHeight === 0;
    const place = (top: number) => {
      scroller.scrollTop = top;
      lastTopRef.current = scroller.scrollTop;
      savedTopRef.current = scroller.scrollTop;
    };
    const settle = () => {
      // Sized to nothing (its tab hidden): nothing to keep, nothing read.
      if (scroller.clientHeight === 0) {
        wasHidden = true;
        return;
      }
      // Back from a hidden tab: the reader's place, not the top.
      const to = placeAfterResize(stuckRef.current, wasHidden);
      if (to === "end") place(scroller.scrollHeight);
      else if (to === "saved") place(savedTopRef.current);
      wasHidden = false;
    };
    settle();
    // Its content growing, and its own size (the pane resized, or hidden).
    const ro = new ResizeObserver(settle);
    ro.observe(inner);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stuckRef.current = followsAfterScroll(
      stuckRef.current,
      el.scrollTop,
      lastTopRef.current,
      gap,
    );
    lastTopRef.current = el.scrollTop;
    savedTopRef.current = el.scrollTop;
  };

  return { scrollRef, innerRef, onScroll };
}
