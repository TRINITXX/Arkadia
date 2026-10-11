import { useRef, type RefObject } from "react";
import { send } from "@/mobile/remote";
import type { RenderPayload } from "@/types";

/** Lines per scroll step, like one desktop wheel notch. */
const STEP_ROWS = 3;
/** Claude Code accelerates wheel notches that arrive too close together. */
const WHEEL_GAP_MS = 110;
const SCROLL_GAP_MS = 40;
/** Wheel travel for one notch in pixel mode. */
const WHEEL_NOTCH_PX = 100;

/**
 * Finger drag (phone) and mouse wheel (old PC) scroll the terminal: through
 * the app's own history when it tracks the mouse (wheel notches), else through
 * Arkadia's scrollback. Dragging down shows earlier lines.
 */
export function useScrollGestures(
  paneId: string | null,
  frameRef: RefObject<RenderPayload | null>,
  rowHeight: number,
) {
  const touchY = useRef(0);
  const travel = useRef(0);
  const lastStep = useRef(0);

  const step = (older: boolean) => {
    const frame = frameRef.current;
    if (!paneId) return;
    const wheel = !!frame && frame.mouse_protocol > 0;
    const now = performance.now();
    if (now - lastStep.current < (wheel ? WHEEL_GAP_MS : SCROLL_GAP_MS)) return;
    lastStep.current = now;
    if (wheel)
      send({
        t: "wheel",
        pane: paneId,
        col: Math.floor(frame.cols / 2),
        row: Math.floor(frame.rows / 2),
        button: older ? 64 : 65,
      });
    else
      send({
        t: "scroll",
        pane: paneId,
        delta: older ? STEP_ROWS : -STEP_ROWS,
      });
  };

  const advance = (delta: number, perStep: number) => {
    travel.current += delta;
    if (Math.abs(travel.current) < perStep) return;
    step(travel.current > 0);
    travel.current = 0;
  };

  return {
    onTouchStart: (e: React.TouchEvent) => {
      touchY.current = e.touches[0].clientY;
      travel.current = 0;
    },
    onTouchMove: (e: React.TouchEvent) => {
      const y = e.touches[0].clientY;
      advance(y - touchY.current, rowHeight * STEP_ROWS);
      touchY.current = y;
    },
    onWheel: (e: React.WheelEvent) => {
      advance(-e.deltaY, e.deltaMode === 0 ? WHEEL_NOTCH_PX : 1);
    },
  };
}
