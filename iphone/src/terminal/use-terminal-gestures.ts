import { useMemo, useRef, type RefObject } from "react";
import { PanResponder, type HostInstance } from "react-native";
import { TAP_SLOP_PX, tapCell } from "@/mobile/tapCell";
import { latestFrame, send } from "~/remote/connection";
import {
  LINE_HEIGHT,
  PAD_X,
  SCROLL_GAP_MS,
  STEP_ROWS,
  WHEEL_GAP_MS,
} from "~/terminal/metrics";
import type { RenderPayload } from "@/types";

/**
 * A finger on the terminal, as on the web page: a drag scrolls (through the
 * app's own history when it tracks the mouse, else Arkadia's scrollback;
 * dragging down shows earlier lines), a tap is a left click where it lands.
 * Neither opens the keyboard.
 */
export function useTerminalGestures(
  areaRef: RefObject<HostInstance | null>,
  paneId: string | null,
  cellWidth: number,
  reclaim: (frame: RenderPayload | null) => void,
) {
  const lastStep = useRef(0);
  const travel = useRef(0);
  const lastDy = useRef(0);
  // PanResponder keeps its first callbacks: they read the latest values here.
  const latest = useRef({ paneId, cellWidth, reclaim });
  latest.current = { paneId, cellWidth, reclaim };

  return useMemo(() => {
    const step = (older: boolean) => {
      const pane = latest.current.paneId;
      const frame = latestFrame(pane);
      if (!pane) return;
      const wheel = !!frame && frame.mouse_protocol > 0;
      const now = performance.now();
      if (now - lastStep.current < (wheel ? WHEEL_GAP_MS : SCROLL_GAP_MS))
        return;
      lastStep.current = now;
      if (wheel)
        send({
          t: "wheel",
          pane,
          col: Math.floor(frame.cols / 2),
          row: Math.floor(frame.rows / 2),
          button: older ? 64 : 65,
        });
      else send({ t: "scroll", pane, delta: older ? STEP_ROWS : -STEP_ROWS });
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        travel.current = 0;
        lastDy.current = 0;
      },
      onPanResponderMove: (_, g) => {
        travel.current += g.dy - lastDy.current;
        lastDy.current = g.dy;
        if (Math.abs(travel.current) < LINE_HEIGHT * STEP_ROWS) return;
        step(travel.current > 0);
        travel.current = 0;
      },
      onPanResponderRelease: (e, g) => {
        const {
          paneId: pane,
          cellWidth: width,
          reclaim: take,
        } = latest.current;
        const frame = latestFrame(pane);
        const moved = Math.hypot(g.dx, g.dy) > TAP_SLOP_PX;
        const { pageX, pageY } = e.nativeEvent;
        if (
          moved ||
          !pane ||
          !frame ||
          frame.mouse_protocol === 0 ||
          width === 0
        ) {
          take(frame);
          return;
        }
        // The touch's own offsets are relative to the row it landed on: place
        // it on the whole area instead. The click goes before the screen
        // takes the pane's size back, so it hits what was shown.
        areaRef.current?.measureInWindow((x, y) => {
          const cell = tapCell(
            pageX - x - PAD_X,
            pageY - y,
            { width, height: LINE_HEIGHT },
            frame,
          );
          if (cell) send({ t: "click", pane, ...cell });
          take(frame);
        });
      },
    });
  }, [areaRef]);
}
