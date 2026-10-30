import { GitBranch } from "lucide-react";
import { modelLabel, resetLabel } from "@/lib/chat/chatLabels";
import type { ChatState } from "@/lib/chat/chatState";

/** Past this share of a window, its figure turns amber. */
const HOT = 0.8;

const pct = (n: number) => `${Math.round(n)} %`;

/** The terminal's status line, under the input: model, context, quotas, reset, branch. */
export function ChatStatusBar({ state }: { state: ChatState }) {
  const { fiveHour, sevenDay } = state.limits;
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
      {fiveHour?.resetsAt && (
        <span>
          Reset <b>{resetLabel(fiveHour.resetsAt)}</b>
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
