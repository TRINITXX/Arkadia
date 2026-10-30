import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { modelLabel, resetLabel } from "@/lib/chat/chatLabels";
import { liveWindow, type ChatState } from "@/lib/chat/chatState";

/** Past this share of a window, its figure turns amber. */
const HOT = 0.8;

/** The countdown moves by the minute: a look every 30 s keeps it current. */
const TICK_MS = 30_000;

const pct = (n: number) => `${Math.round(n)} %`;

/** The terminal's status line, under the input: model, context, quotas, reset, branch. */
export function ChatStatusBar({ state }: { state: ChatState }) {
  const [now, setNow] = useState(() => Date.now());
  const fiveReset = state.limits.fiveHour?.resetsAt;
  const sevenReset = state.limits.sevenDay?.resetsAt;
  useEffect(() => {
    if (fiveReset === undefined && sevenReset === undefined) return;
    // The clock stood still while no reset was known.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [fiveReset, sevenReset]);

  const fiveHour = liveWindow(state.limits.fiveHour, now);
  const sevenDay = liveWindow(state.limits.sevenDay, now);
  const reset =
    fiveHour?.resetsAt !== undefined
      ? resetLabel(fiveHour.resetsAt, now)
      : null;
  return (
    <div className="chat-status">
      <span>
        <b>{modelLabel(state.model)}</b>
      </span>
      {state.context && (
        <span
          className={state.context.percentage >= HOT * 100 ? "hot" : undefined}
        >
          Contexte <b>{pct(state.context.percentage)}</b>
        </span>
      )}
      {fiveHour && (
        <span className={fiveHour.utilization >= HOT ? "hot" : undefined}>
          Session <b>{pct(fiveHour.utilization * 100)}</b>
        </span>
      )}
      {sevenDay && (
        <span className={sevenDay.utilization >= HOT ? "hot" : undefined}>
          Semaine <b>{pct(sevenDay.utilization * 100)}</b>
        </span>
      )}
      {reset && (
        <span>
          Reset dans <b>{reset}</b>
        </span>
      )}
      {state.gitBranch && (
        <span>
          <GitBranch size={11} style={{ verticalAlign: -1 }} />{" "}
          <b>{state.gitBranch}</b>
        </span>
      )}
    </div>
  );
}
