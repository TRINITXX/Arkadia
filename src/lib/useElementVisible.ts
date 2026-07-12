import { useEffect, useState, type RefObject } from "react";

/**
 * Whether the element is actually on screen. `display: none` ancestors (a
 * hidden tab) and off-viewport positions both report false, so a hidden pane
 * can suspend its per-frame work and resume with the latest state on re-show.
 */
export function useElementVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return visible;
}
