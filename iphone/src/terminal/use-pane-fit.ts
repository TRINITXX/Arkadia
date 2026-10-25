import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent, TextLayoutEvent } from "react-native";
import { send } from "~/remote/connection";
import { LINE_HEIGHT, PAD_X } from "~/terminal/metrics";
import type { RenderPayload } from "@/types";

/** Characters of the hidden ruler the cell width is measured on. */
export const RULER = "0".repeat(50);

type Size = { cols: number; rows: number };

/**
 * Sizes the watched pane's PTY to the terminal's area, following the
 * keyboard as it opens and closes. The desktop takes its size back when
 * touched there; `reclaim` takes the phone's back on the next touch here.
 */
export function usePaneFit(paneId: string | null) {
  const [cellWidth, setCellWidth] = useState(0);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const size = useRef<Size | null>(null);

  const onRulerLayout = useCallback((e: TextLayoutEvent) => {
    const width = e.nativeEvent.lines[0]?.width ?? 0;
    if (width > 0) setCellWidth(width / RULER.length);
  }, []);

  const onAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  }, []);

  // Another pane starts from no size, so the effect below sends it one.
  // Declared first: effects run in order, and the size must be forgotten
  // before it is compared.
  useEffect(() => {
    size.current = null;
  }, [paneId]);

  useEffect(() => {
    if (!paneId || cellWidth === 0 || area.width === 0) return;
    const next = {
      cols: Math.max(20, Math.floor((area.width - 2 * PAD_X) / cellWidth)),
      rows: Math.max(5, Math.floor(area.height / LINE_HEIGHT)),
    };
    const prev = size.current;
    size.current = next;
    if (prev?.cols !== next.cols || prev?.rows !== next.rows)
      send({ t: "resize", pane: paneId, ...next });
  }, [paneId, cellWidth, area]);

  const reclaim = useCallback(
    (frame: RenderPayload | null) => {
      const want = size.current;
      if (!paneId || !want || !frame) return;
      if (frame.cols !== want.cols || frame.rows !== want.rows)
        send({ t: "resize", pane: paneId, ...want });
    },
    [paneId],
  );

  return { cellWidth, onRulerLayout, onAreaLayout, reclaim };
}
