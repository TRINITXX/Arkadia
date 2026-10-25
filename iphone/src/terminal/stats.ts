/**
 * The prototype's measures, shown over the terminal so Alexis can compare it
 * with the web page: frames per second, and where a keystroke's time goes
 * (echo = network round trip + PC + display).
 */

import { useSyncExternalStore } from "react";

export interface TerminalStats {
  /** Frames received from the PC over the last second. */
  fps: number;
  /** Median, last 20: keystroke sent → next frame received, Claude idle. */
  echoMs: number | null;
  /** Median, last 20: a bare HTTP round trip to the PC. */
  networkMs: number | null;
  /** Median, last 20: frame received → drawn on screen. */
  displayMs: number | null;
}

const SAMPLES = 20;
const PUBLISH_EVERY_MS = 500;

const frameTimes: number[] = [];
const echo: number[] = [];
const network: number[] = [];
const display: number[] = [];
let inputSentAt: number | null = null;
let echoOn = true;
let stats: TerminalStats = {
  fps: 0,
  echoMs: null,
  networkMs: null,
  displayMs: null,
};
let lastPublish = 0;
const subs = new Set<() => void>();

function median(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

function push(samples: number[], value: number) {
  samples.push(value);
  if (samples.length > SAMPLES) samples.shift();
}

/** At most twice a second: the overlay must not cost what it measures. */
function publish(force = false) {
  const now = performance.now();
  if (!force && now - lastPublish < PUBLISH_EVERY_MS) return;
  lastPublish = now;
  while (frameTimes.length > 0 && now - frameTimes[0] > 1000)
    frameTimes.shift();
  stats = {
    fps: frameTimes.length,
    echoMs: median(echo),
    networkMs: median(network),
    displayMs: median(display),
  };
  for (const cb of subs) cb();
}

/**
 * Echo is measured only while Claude waits: when it works, its animation
 * sends frames of its own, and the next frame is not the keystroke's.
 */
export function measureEcho(on: boolean) {
  echoOn = on;
  if (!on) inputSentAt = null;
}

/** A keystroke left for the PC; the first one waiting for its echo counts. */
export function noteInput() {
  if (echoOn) inputSentAt ??= performance.now();
}

export function noteFrame(receivedAt: number) {
  frameTimes.push(receivedAt);
  if (inputSentAt !== null) {
    push(echo, receivedAt - inputSentAt);
    inputSentAt = null;
  }
  publish();
}

export function noteDisplayed(receivedAt: number) {
  push(display, performance.now() - receivedAt);
}

export function noteNetwork(ms: number) {
  push(network, ms);
  publish(true);
}

export function useTerminalStats(): TerminalStats {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => stats,
  );
}
