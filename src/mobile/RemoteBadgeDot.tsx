import { AgentBadge } from "@/components/AgentBadge";
import type { AgentStateValue } from "@/lib/agentState";
import type { RemoteBadge } from "@/lib/remoteSnapshot";

function stateOf(badge: RemoteBadge): AgentStateValue {
  if (badge === "busy") return { kind: "busy" };
  if (badge === null) return { kind: "none" };
  return {
    kind: "waiting",
    session_id: "",
    shellRunning: badge === "waiting-shell",
  };
}

/** The desktop's green / amber badge. */
export function RemoteBadgeDot({ badge }: { badge: RemoteBadge }) {
  return <AgentBadge state={stateOf(badge)} size={9} inline />;
}
