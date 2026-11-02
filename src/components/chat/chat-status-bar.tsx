import { useEffect, useState } from "react";
import { GitBranch, Timer } from "lucide-react";
import { ChatContextGauge } from "@/components/chat/chat-context-gauge";
import { ChatMcpChip } from "@/components/chat/chat-mcp-chip";
import { ChatRing } from "@/components/chat/chat-ring";
import type { ContextDetail } from "@/lib/chat/chatProtocol";
import type { ChatState } from "@/lib/chat/chatState";
import { statusFigures } from "@/lib/chat/chatStatus";
import { useChatShown } from "@/lib/chat/useChatShown";

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

  // The same figures as the iPhone's row (`statusFigures`).
  const { context, fiveHour, sevenDay, reset, resetFull } = statusFigures(
    state,
    now,
  );
  return (
    <div className="chat-status">
      {context && (
        <ChatContextGauge
          percentage={context.percent}
          hot={context.hot}
          onDetail={onContextDetail}
        />
      )}
      {fiveHour && (
        <span title={`Session de 5 h utilisée : ${pct(fiveHour.percent)}`}>
          <ChatRing percent={fiveHour.percent} hot={fiveHour.hot} />
          Session
        </span>
      )}
      {sevenDay && (
        <span title={`Semaine utilisée : ${pct(sevenDay.percent)}`}>
          <ChatRing percent={sevenDay.percent} hot={sevenDay.hot} />
          Semaine
        </span>
      )}
      {reset && (
        <span title={`Reset de la session dans ${resetFull}`}>
          <Timer size={13} />
          <b>{reset}</b>
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
