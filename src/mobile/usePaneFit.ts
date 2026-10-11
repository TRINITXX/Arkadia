import { useCallback, useEffect, useRef, type RefObject } from "react";
import { measureCellSize } from "@/lib/cellSize";
import { send } from "@/mobile/remote";
import type { RenderPayload } from "@/types";

export const TERMINAL_FONT_FAMILY =
  'ui-monospace, Menlo, "Cascadia Code", Consolas, monospace';
export const LINE_HEIGHT = 1.25;
/** Side padding of the grid, each side. */
export const PAD_X = 8;

type Size = { cols: number; rows: number };

/**
 * Sizes the watched pane's PTY to the phone's screen, following the keyboard
 * as it opens and closes. The desktop takes its size back when touched there;
 * the returned `reclaim` takes the phone's back on the next touch here.
 */
export function usePaneFit(
  paneId: string | null,
  gridRef: RefObject<HTMLDivElement | null>,
  fontSize: number,
): (frame: RenderPayload | null) => void {
  const size = useRef<Size | null>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el || !paneId) return;
    const cell = measureCellSize(TERMINAL_FONT_FAMILY, fontSize);
    const rowHeight = fontSize * LINE_HEIGHT;
    const measure = () => {
      const width = el.clientWidth - 2 * PAD_X;
      const height = el.clientHeight;
      if (width <= 0 || height <= 0) return;
      const next = {
        cols: Math.max(20, Math.floor(width / cell.width)),
        rows: Math.max(5, Math.floor(height / rowHeight)),
      };
      const prev = size.current;
      size.current = next;
      if (prev?.cols !== next.cols || prev?.rows !== next.rows)
        send({ t: "resize", pane: paneId, ...next });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => {
      observer.disconnect();
      size.current = null;
    };
  }, [paneId, gridRef, fontSize]);

  return useCallback(
    (frame: RenderPayload | null) => {
      const want = size.current;
      if (!paneId || !want || !frame) return;
      if (frame.cols !== want.cols || frame.rows !== want.rows)
        send({ t: "resize", pane: paneId, ...want });
    },
    [paneId],
  );
}
