import { useLayoutEffect } from "react";
import {
  recallColumn,
  rememberColumn,
  type ColumnPlace,
} from "@/lib/chat/chatLive";

/** The reader's place is read again this long after scrolling stops. */
const SETTLE_MS = 150;

/**
 * The column's place, or null when it has no layout (its tab hidden: the
 * pane sized to nothing). Rows stack down, so the first one ending below the
 * view's top is found by halving.
 */
export function measureColumn(
  scroller: HTMLElement,
  inner: HTMLElement,
  stuck: boolean,
): ColumnPlace | null {
  if (scroller.clientHeight === 0 || scroller.clientWidth === 0) return null;
  if (stuck) return { index: 0, offset: 0, stuck: true };
  const top = scroller.getBoundingClientRect().top;
  const rows = inner.children;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > top) hi = mid;
    else lo = mid + 1;
  }
  const row = rows[lo];
  if (!row) return null;
  return {
    index: lo,
    offset: row.getBoundingClientRect().top - top,
    stuck: false,
  };
}

/**
 * A chat's column comes back where the reader left it when its pane mounts
 * again (another project was on screen): at the end if it followed the end,
 * else on the row that was at the top, at the same height. A row, not a
 * `scrollTop`: rows not drawn yet count a guessed height (`content-visibility`).
 * The place kept is the last one read while the column had a layout: a
 * hidden tab's pane is sized to nothing, its scroll falls to 0 meanwhile, and
 * reading it then would bring the reader back to the top.
 * Declared before the column's own « stay at the end » effect.
 */
export function useColumnMemory(
  memoryKey: string | undefined,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  innerRef: React.RefObject<HTMLDivElement | null>,
  stuckRef: React.MutableRefObject<boolean>,
  onLeaveEnd: () => void,
): void {
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const inner = innerRef.current;
    if (!memoryKey || !scroller || !inner) return;
    const restore = (p: ColumnPlace) => {
      const row = inner.children[p.index];
      if (!row) return;
      scroller.scrollTop +=
        row.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        p.offset;
    };
    const place = recallColumn(memoryKey);
    // Mounted in a hidden tab (no size): the place goes back on first show.
    let pending: ColumnPlace | null = null;
    if (place && !place.stuck) {
      onLeaveEnd();
      if (scroller.clientHeight > 0) restore(place);
      else pending = place;
    }
    const read = () => measureColumn(scroller, inner, stuckRef.current);
    let last = read() ?? place;
    const shown = new ResizeObserver(() => {
      if (!pending || scroller.clientHeight === 0) return;
      restore(pending);
      pending = null;
      shown.disconnect();
      last = read() ?? last;
    });
    if (pending) shown.observe(scroller);
    let timer: number | undefined;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        last = read() ?? last;
      }, SETTLE_MS);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      shown.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
      // Still in the page here: React runs this before removing the nodes.
      const now = read() ?? last;
      if (now) rememberColumn(memoryKey, now);
    };
    // Once per chat shown: the reader's own scrolling does the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryKey]);
}
