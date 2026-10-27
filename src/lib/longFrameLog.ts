import { invoke } from "@tauri-apps/api/core";

/** A page frame blocked this long is logged. A felt freeze starts around here. */
const LONG_FRAME_MS = 400;

/** The scripts named per frame, longest first. */
const SCRIPTS_PER_FRAME = 3;

// `long-animation-frame` entries (Chromium 123+), absent from the DOM typings.
interface LoafScript {
  duration: number;
  invoker: string;
  invokerType: string;
  sourceURL: string;
  sourceFunctionName: string;
  sourceCharPosition: number;
}

interface LoafEntry extends PerformanceEntry {
  blockingDuration: number;
  scripts: LoafScript[];
}

/** One log line for a long frame: its length and the scripts that held it. */
export function describeLongFrame(entry: LoafEntry): string {
  const scripts = [...entry.scripts]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, SCRIPTS_PER_FRAME)
    .map((s) => {
      const file = s.sourceURL.split("/").pop() ?? "";
      const fn = s.sourceFunctionName ? ` ${s.sourceFunctionName}` : "";
      return `${Math.round(s.duration)}ms ${s.invokerType} ${s.invoker} @ ${file}:${s.sourceCharPosition}${fn}`;
    });
  return `[longframe] ${Math.round(entry.duration)}ms (blocking ${Math.round(entry.blockingDuration)}ms) ${scripts.join(" | ")}`;
}

/**
 * Writes every page frame blocked over `LONG_FRAME_MS` to `popup.log`, with
 * the scripts that ran in it. The watchdog only speaks after 5 s of page
 * silence, so the 1 to 3 s freezes on a tab switch left no trace (27/10/2026).
 * `sourceCharPosition` points into the built bundle under `dist/assets`.
 */
export function startLongFrameLog(): void {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")
  ) {
    return;
  }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LoafEntry[]) {
      if (entry.duration < LONG_FRAME_MS) continue;
      void invoke("popup_log_ui", { msg: describeLongFrame(entry) }).catch(
        () => {},
      );
    }
  }).observe({ type: "long-animation-frame", buffered: true });
}
