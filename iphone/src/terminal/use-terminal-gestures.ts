import { useEffect, useMemo, useRef, type RefObject } from "react";
import { PanResponder, type HostInstance } from "react-native";
import { TAP_SLOP_PX, tapCell } from "@/mobile/tapCell";
import {
  decay,
  FLING_MIN_SPEED,
  FLING_STOP_SPEED,
  releaseSpeed,
  smoothSpeed,
  takeSteps,
  wheelGap,
} from "@/lib/touchScroll";
import { latestFrame, send } from "~/remote/connection";
import { LINE_HEIGHT, PAD_X } from "~/terminal/metrics";
import type { RenderPayload } from "@/types";

/** Finger travel for one wheel notch (an app that tracks the mouse). */
const NOTCH_PX = LINE_HEIGHT * 2;
/** Notches allowed to wait: more would lag when the finger turns back. */
const MAX_NOTCH_BACKLOG = 2;
/** Arkadia's scrollback: one send per frame the PC streams (~30 per second). */
const SCROLL_SEND_MS = 33;

/**
 * A finger on the terminal: a drag scrolls (through the app's own history
 * when it tracks the mouse, as Claude Code does, else Arkadia's scrollback;
 * dragging down shows earlier lines), a tap is a left click where it lands.
 * Neither opens the keyboard. The scroll follows the finger's speed and a
 * flick carries on after release, slowing down like an iOS list
 * (`touchScroll`): the PC still draws every line, so the phone sends often.
 */
export function useTerminalGestures(
  areaRef: RefObject<HostInstance | null>,
  paneId: string | null,
  cellWidth: number,
  reclaim: (frame: RenderPayload | null) => void,
) {
  // Travel not sent yet (px, towards the bottom > 0), the finger's speed
  // (px/ms), when the last step left, and the running fling's frame.
  const travel = useRef(0);
  const speed = useRef(0);
  const lastSend = useRef(0);
  const lastDy = useRef(0);
  const lastMoveAt = useRef(0);
  const fling = useRef<number | null>(null);
  // This touch stopped a fling: lifting it is no tap.
  const stoppedFling = useRef(false);
  // PanResponder keeps its first callbacks: they read the latest values here.
  const latest = useRef({ paneId, cellWidth, reclaim });
  latest.current = { paneId, cellWidth, reclaim };

  const stopFling = () => {
    if (fling.current !== null) cancelAnimationFrame(fling.current);
    fling.current = null;
  };
  useEffect(() => stopFling, []);
  // Another pane: whatever was flinging belonged to the previous one.
  useEffect(() => {
    stopFling();
    travel.current = 0;
  }, [paneId]);

  return useMemo(() => {
    /** Sends what the travel so far adds up to, at the pace the PC takes. */
    const pump = (now: number) => {
      const pane = latest.current.paneId;
      if (!pane) return;
      const frame = latestFrame(pane);
      const wheel = !!frame && frame.mouse_protocol > 0;
      if (wheel) {
        if (now - lastSend.current < wheelGap(speed.current)) return;
        const { steps } = takeSteps(travel.current, NOTCH_PX);
        if (steps === 0) return;
        const older = steps > 0;
        send({
          t: "wheel",
          pane,
          col: Math.floor(frame.cols / 2),
          row: Math.floor(frame.rows / 2),
          button: older ? 64 : 65,
        });
        const left = travel.current - Math.sign(steps) * NOTCH_PX;
        const cap = MAX_NOTCH_BACKLOG * NOTCH_PX;
        travel.current = Math.max(-cap, Math.min(cap, left));
      } else {
        if (now - lastSend.current < SCROLL_SEND_MS) return;
        const { steps, rest } = takeSteps(travel.current, LINE_HEIGHT);
        if (steps === 0) return;
        send({ t: "scroll", pane, delta: steps });
        travel.current = rest;
      }
      lastSend.current = now;
    };

    /** Carries a flick on, frame by frame, until it has slowed down. */
    const startFling = (initial: number) => {
      stopFling();
      speed.current = initial;
      let last = performance.now();
      const frame = (now: number) => {
        const dt = Math.min(now - last, 64);
        last = now;
        travel.current += speed.current * dt;
        speed.current = decay(speed.current, dt);
        pump(now);
        fling.current =
          Math.abs(speed.current) > FLING_STOP_SPEED
            ? requestAnimationFrame(frame)
            : null;
      };
      fling.current = requestAnimationFrame(frame);
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // A finger down stops a flick, as on any iOS list.
        stoppedFling.current = fling.current !== null;
        stopFling();
        travel.current = 0;
        speed.current = 0;
        lastDy.current = 0;
        lastMoveAt.current = performance.now();
      },
      onPanResponderMove: (_, g) => {
        const now = performance.now();
        const dy = g.dy - lastDy.current;
        speed.current = smoothSpeed(
          speed.current,
          dy,
          now - lastMoveAt.current,
        );
        lastDy.current = g.dy;
        lastMoveAt.current = now;
        travel.current += dy;
        pump(now);
      },
      onPanResponderTerminate: () => {
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
        if (moved) {
          const v = releaseSpeed(
            speed.current,
            performance.now() - lastMoveAt.current,
          );
          if (Math.abs(v) > FLING_MIN_SPEED) startFling(v);
          take(frame);
          return;
        }
        const { pageX, pageY } = e.nativeEvent;
        if (
          stoppedFling.current ||
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
