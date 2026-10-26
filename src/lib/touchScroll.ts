/**
 * Finger scrolling of a remote terminal (the iPhone app): the PC scrolls,
 * the phone only decides how much and how fast. The finger's speed sets the
 * pace, and a flick carries on after release, slowing down like an iOS list.
 */

/** Speed below which a released finger does not carry on (px/ms). */
export const FLING_MIN_SPEED = 0.25;
/** Speed at which the carry-on stops (px/ms). */
export const FLING_STOP_SPEED = 0.03;
/** A finger held still this long before lifting has stopped: no carry-on. */
const RELEASE_STILL_MS = 50;
/** Fraction of its speed a fling keeps per millisecond (iOS "normal"). */
const DECELERATION_PER_MS = 0.997;
/** Weight of the latest move in the smoothed speed. */
const SPEED_SMOOTHING = 0.6;

/** Claude Code accelerates notches closer than ~110 ms: slow drags stay precise. */
const WHEEL_GAP_SLOW_MS = 110;
/** A fast finger lets that acceleration act: long jumps for a flick. */
const WHEEL_GAP_FAST_MS = 45;
/** From this speed on (px/ms), the finger counts as fast. */
const FAST_SPEED = 1.2;

/** The finger's speed (px/ms), smoothed over the moves. */
export function smoothSpeed(
  previous: number,
  dy: number,
  dtMs: number,
): number {
  if (dtMs <= 0) return previous;
  const now = dy / dtMs;
  return previous * (1 - SPEED_SMOOTHING) + now * SPEED_SMOOTHING;
}

/**
 * The speed a lifted finger hands to the fling. iOS sends no move while the
 * finger rests, so the last measured speed would outlive a pause.
 */
export function releaseSpeed(
  smoothed: number,
  sinceLastMoveMs: number,
): number {
  return sinceLastMoveMs > RELEASE_STILL_MS ? 0 : smoothed;
}

/** A fling's speed after `dtMs` more milliseconds. */
export function decay(speed: number, dtMs: number): number {
  return speed * Math.pow(DECELERATION_PER_MS, dtMs);
}

/** The pause between two wheel notches at this finger speed. */
export function wheelGap(speed: number): number {
  return Math.abs(speed) >= FAST_SPEED ? WHEEL_GAP_FAST_MS : WHEEL_GAP_SLOW_MS;
}

/**
 * Whole steps of `stepPx` in the travel not yet sent, and the remainder kept
 * for the next move (travel towards the bottom is positive).
 */
export function takeSteps(
  travelPx: number,
  stepPx: number,
): { steps: number; rest: number } {
  const steps = Math.trunc(travelPx / stepPx);
  return { steps, rest: travelPx - steps * stepPx };
}
