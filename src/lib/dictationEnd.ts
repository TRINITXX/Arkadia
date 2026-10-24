import { getFrame, subscribeFrame } from "@/lib/frameStore";
import { inputRowIndex, isDictating } from "@/lib/terminalChrome";

/**
 * How long the voice status must stay gone before the prompt counts as holding
 * the transcript: a frame may show the usual hints a beat before the final
 * text lands.
 */
export const DICTATION_SETTLE_MS = 300;

/** A transcription still running by then won't finish: better not send half a prompt. */
export const DICTATION_TIMEOUT_MS = 30_000;

/**
 * Resolves true once the pane's dictation is over — recording stopped and its
 * text written into the prompt — or false if it is still going after
 * DICTATION_TIMEOUT_MS. The settle is a timer, not a frame count: frames stop
 * coming once the screen is still. A frame without the input line, where the
 * status would sit, tells nothing and holds the settle off.
 */
export function waitForDictationEnd(paneId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settle: ReturnType<typeof setTimeout> | null = null;
    const finish = (ended: boolean) => {
      unsubscribe();
      if (settle) clearTimeout(settle);
      clearTimeout(giveUp);
      resolve(ended);
    };
    const check = () => {
      const frame = getFrame(paneId);
      if (isDictating(frame) || inputRowIndex(frame) < 0) {
        if (settle) clearTimeout(settle);
        settle = null;
      } else if (!settle) {
        settle = setTimeout(() => finish(true), DICTATION_SETTLE_MS);
      }
    };
    const unsubscribe = subscribeFrame(paneId, check);
    const giveUp = setTimeout(() => finish(false), DICTATION_TIMEOUT_MS);
    check();
  });
}
