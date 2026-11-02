import { resetLabel } from "@/lib/chat/chatLabels";
import {
  liveWindow,
  type ChatState,
  type RateWindow,
} from "@/lib/chat/chatState";

/** Past this share of a window, its figure turns amber. */
export const HOT = 0.8;

/** A ring of the status row: its figure (0-100), amber once it runs hot. */
export interface StatusRing {
  percent: number;
  hot: boolean;
}

/** A plan's window as its ring shows it, with when it starts again. */
export interface WindowRing extends StatusRing {
  /** Epoch seconds; unknown past a reset, until the next request. */
  resetsAt?: number;
}

export interface StatusFigures {
  context: StatusRing | null;
  fiveHour: WindowRing | null;
  sevenDay: WindowRing | null;
  /** The session's reset, short: « 2 h 15 », « 45 min ». */
  reset: string | null;
  /** The same in full words, for a tooltip or VoiceOver: « 2 h 15 min ». */
  resetFull: string | null;
}

const ring = (share: number): StatusRing => ({
  percent: share * 100,
  hot: share >= HOT,
});

const windowRing = (win: RateWindow | undefined): WindowRing | null =>
  win ? { ...ring(win.utilization), resetsAt: win.resetsAt } : null;

/**
 * The terminal's status line as the chat's bottom row shows it, on the PC
 * and on the iPhone alike: the context, the 5 h session and the week as
 * rings that turn amber from 80 %, the session's reset as a countdown. A
 * window past its reset reads 0 until the next request (`liveWindow`).
 */
export function statusFigures(
  state: Pick<ChatState, "context" | "limits">,
  now: number,
): StatusFigures {
  const fiveHour = liveWindow(state.limits.fiveHour, now);
  const reset =
    fiveHour?.resetsAt !== undefined
      ? resetLabel(fiveHour.resetsAt, now)
      : null;
  return {
    context: state.context ? ring(state.context.percentage / 100) : null,
    fiveHour: windowRing(fiveHour),
    sevenDay: windowRing(liveWindow(state.limits.sevenDay, now)),
    // Hours lead: « 2 h 15 », the minutes go without saying.
    reset: reset?.includes(" h ") ? reset.replace(/ min$/, "") : reset,
    resetFull: reset,
  };
}
