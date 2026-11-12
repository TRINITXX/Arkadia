import { useEffect, useState } from "react";
import { GitBranch, Timer } from "lucide-react";
import { ChatContextGauge } from "@/components/chat/chat-context-gauge";
import { ChatMcpChip } from "@/components/chat/chat-mcp-chip";
import { ChatRing } from "@/components/chat/chat-ring";
import {
  ChatWeekGauge,
  type WeekModelShare,
} from "@/components/chat/chat-week-gauge";
import { useAccountLabel, useModelQuota } from "@/lib/accountQuota";
import { modelFamily } from "@/lib/accounts";
import type { ContextDetail } from "@/lib/chat/chatProtocol";
import { liveWindow, type ChatState } from "@/lib/chat/chatState";
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
  accountId,
  onContextDetail,
  onMcpOpen,
}: {
  state: ChatState;
  /** The pane's account: its name and Fable's share in the week's card. */
  accountId?: string;
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
  // Fable's share: the chat's own `/usage` first, else the 30-min poll's;
  // a refusal holding it out comes from the limit switch's blocks.
  const quota = useModelQuota(accountId);
  const account = useAccountLabel(accountId);
  const own = state.limits.models?.find((m) => modelFamily(m.model) === "fable");
  const ownNow = own ? liveWindow(own, now) : undefined;
  const fable: WeekModelShare | null =
    own || quota
      ? {
          model: own?.model ?? quota?.model ?? "Fable",
          percent: ownNow ? ownNow.utilization * 100 : (quota?.pct ?? null),
          resetsAt: ownNow ? ownNow.resetsAt : quota?.resetsAt,
          outUntil: quota?.blockedUntil ?? null,
        }
      : null;
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
        <ChatWeekGauge
          week={sevenDay}
          fable={fable}
          account={account}
          now={now}
        />
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
