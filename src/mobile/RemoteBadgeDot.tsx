import { AgentBadge } from "@/components/AgentBadge";
import type { AgentStateValue } from "@/lib/agentState";
import type { RemoteBadge } from "@/lib/remoteSnapshot";

/** A badge back as the desktop's agent state (what the shared views read). */
export function agentStateOf(badge: RemoteBadge): AgentStateValue {
  if (badge === null) return { kind: "none" };
  const artifactOpen = badge.endsWith("-artifact");
  if (badge.startsWith("busy")) return { kind: "busy", artifactOpen };
  return {
    kind: "waiting",
    session_id: "",
    shellRunning: badge.startsWith("waiting-shell"),
    artifactOpen,
  };
}

/** The desktop's green / amber badge. */
export function RemoteBadgeDot({ badge }: { badge: RemoteBadge }) {
  return <AgentBadge state={agentStateOf(badge)} size={9} inline />;
}
