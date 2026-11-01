import { useEffect, useState } from "react";
import { GitBranch, Timer } from "lucide-react";
import { ChatContextGauge } from "@/components/chat/chat-context-gauge";
import { ChatMcpChip } from "@/components/chat/chat-mcp-chip";
import { ChatRing } from "@/components/chat/chat-ring";
import type { ContextDetail } from "@/lib/chat/chatProtocol";
import { resetLabel } from "@/lib/chat/chatLabels";
import { liveWindow, type ChatState } from "@/lib/chat/chatState";
import { useChatShown } from "@/lib/chat/useChatShown";

/** Past this share of a window, its figure turns amber. */
const HOT = 0.8;

/** The countdown moves by the minute: a look every 30 s keeps it current. */
const TICK_MS = 30_000;

const pct = (n: number) => `${Math.round(n)} %`;

/**
 * The terminal's status line, in the input's bottom row after the session's
 * button (`ChatSessionMenu`): context, quotas, reset, branch.
 * Context and quotas as rings with their figure inside (the user's pick of
 * 30/10/2026), the reset as a short countdown.
 */
export function ChatStatusBar({
  state,
  onContextDetail,
  onMcpOpen,
}: {
  state: ChatState;
  /** The context by category, for the ring's hover (`ChatContextGauge`). */
  onContextDetail?: () => Promise<ContextDetail>;
  /** The MCP list opened: their state asked again. */
  onMcpOpen?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const fiveReset = state.limits.fiveHour?.resetsAt;
  const sevenReset = state.limits.sevenDay?.resetsAt;
  // Hidden tab: no countdown to keep; right again on return.
  const shown = useChatShown();
  useEffect(() => {
    if (!shown) return;
    if (fiveReset === undefined && sevenReset === undefined) return;
    // The clock stood still while no reset was known.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [fiveReset, sevenReset, shown]);

  const fiveHour = liveWindow(state.limits.fiveHour, now);
  const sevenDay = liveWindow(state.limits.sevenDay, now);
  const reset =
    fiveHour?.resetsAt !== undefined
      ? resetLabel(fiveHour.resetsAt, now)
      : null;
  return (
    <div className="chat-status">
      {state.context && (
        <ChatContextGauge
          percentage={state.context.percentage}
          hot={state.context.percentage >= HOT * 100}
          onDetail={onContextDetail}
        />
      )}
      {fiveHour && (
        <span
          title={`Session de 5 h utilisée : ${pct(fiveHour.utilization * 100)}`}
        >
          <ChatRing
            percent={fiveHour.utilization * 100}
            hot={fiveHour.utilization >= HOT}
          />
          Session
        </span>
      )}
      {sevenDay && (
        <span title={`Semaine utilisée : ${pct(sevenDay.utilization * 100)}`}>
          <ChatRing
            percent={sevenDay.utilization * 100}
            hot={sevenDay.utilization >= HOT}
          />
          Semaine
        </span>
      )}
      {reset && (
        <span title={`Reset de la session dans ${reset}`}>
          <Timer size={13} />
          <b>{reset.includes(" h ") ? reset.replace(/ min$/, "") : reset}</b>
        </span>
      )}
      {state.gitBranch && (
        <span>
          <GitBranch size={11} style={{ verticalAlign: -1 }} />{" "}
          <b>{state.gitBranch}</b>
        </span>
      )}
      <ChatMcpChip servers={state.sdk.mcpServers} onOpen={onMcpOpen} />
    </div>
  );
}
