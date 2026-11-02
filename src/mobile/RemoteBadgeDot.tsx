import { AgentBadge } from "@/components/AgentBadge";
import type { AgentStateValue } from "@/lib/agentState";
import type { RemoteBadge } from "@/lib/remoteSnapshot";

/** A badge back as the desktop's agent state (what the shared views read). */
export function agentStateOf(
  badge: RemoteBadge,
  question = false,
): AgentStateValue {
  if (badge === null) return { kind: "none" };
  const artifactOpen = badge.endsWith("-artifact");
  const asked = question ? { questionPending: true } : {};
  if (badge.startsWith("busy")) return { kind: "busy", artifactOpen, ...asked };
  return {
    kind: "waiting",
    session_id: "",
    shellRunning: badge.startsWith("waiting-shell"),
    artifactOpen,
    ...asked,
  };
}

/** The desktop's green / amber badge. */
export function RemoteBadgeDot({
  badge,
  question,
}: {
  badge: RemoteBadge;
  question: boolean;
}) {
  return <AgentBadge state={agentStateOf(badge, question)} size={9} inline />;
}
