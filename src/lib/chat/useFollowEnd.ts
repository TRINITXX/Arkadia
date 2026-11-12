import { useLayoutEffect, useRef } from "react";
import { followsAfterScroll } from "@/lib/followBottom";

/**
 * A scroller kept at its end while its content grows: a subagent's sheet,
 * followed as the agent works. Only the reader scrolling up leaves the end,
 * and coming back down to it follows again (`followsAfterScroll`, as the
 * chat's column). `fromEnd`: opened at its end (an agent still running), else
 * at its start, to be read from the top.
 */
export function useFollowEnd(fromEnd: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(fromEnd);
  /** `scrollTop` at the last scroll event or stick. */
  const lastTopRef = useRef(0);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const inner = innerRef.current;
    if (!scroller || !inner) return;
    const stick = () => {
      // Sized to nothing (its tab hidden): nothing to keep.
      if (!stuckRef.current || scroller.clientHeight === 0) return;
      scroller.scrollTop = scroller.scrollHeight;
      lastTopRef.current = scroller.scrollTop;
    };
    stick();
    // Its content growing, and its own size (the pane resized).
    const ro = new ResizeObserver(stick);
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
  };

  return { scrollRef, innerRef, onScroll };
}
