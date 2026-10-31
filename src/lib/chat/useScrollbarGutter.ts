import { useEffect, useState } from "react";

/**
 * The width the scroll area's scrollbar takes (its gutter is always kept,
 * `chat-css`), so the input under it pads its right by as much and centers
 * on the same column as the messages (the user's ask of 31/10/2026).
 */
export function useScrollbarGutter(
  ref: React.RefObject<HTMLElement | null>,
): number {
  const [gutter, setGutter] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fires once on observe, then on every resize (a zoom changes it too).
    const observer = new ResizeObserver(() => {
      // A hidden tab's pane is sized to nothing: keep the last width.
      if (el.offsetWidth === 0) return;
      setGutter(el.offsetWidth - el.clientWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return gutter;
}
