import { CircleAlert, CircleCheck } from "lucide-react";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import { toolStep } from "@/lib/chat/chatSteps";

/**
 * The running subagents, one live card each, docked above the input (the
 * user's pick of 30/10/2026): what it does in a line (its progress summary,
 * else its description), its type, time, tokens and last action. A card
 * that ends shows ✓ a moment, then leaves (`agentCards`). A click opens its
 * conversation.
 */
export function ChatAgentCards({
  agents,
  cwd,
  now,
  onOpen,
}: {
  /** Already filtered: running, or just ended (`agentCards`). */
  agents: Subagent[];
  cwd: string | null;
  now: number;
  onOpen: (agent: Subagent) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <div className="chat-agent-cards">
      {agents.map((agent) => (
        <AgentCard
          key={agent.taskId}
          agent={agent}
          cwd={cwd}
          now={now}
          onOpen={() => onOpen(agent)}
        />
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  cwd,
  now,
  onOpen,
}: {
  agent: Subagent;
  cwd: string | null;
  now: number;
  onOpen: () => void;
}) {
  const running = agent.status === "running";
  const elapsed = agent.startedAt
    ? (agent.endedAt ?? now) - agent.startedAt
    : agent.durationMs;
  // Its AI summary comes every ~30 s; before it, the line is its last action.
  const summary = agent.summary?.split("\n")[0];
  const action = agent.lastAction
    ? toolStep(agent.lastAction.name, agent.lastAction.input, cwd)
    : null;
  const line = summary || action || "démarre…";
  return (
    <div
      className={`chat-agent-card${running ? "" : ` ended ${agent.status}`}`}
      onClick={onOpen}
      title="Ouvrir sa conversation"
    >
      <div className="r1">
        {running ? (
          <span className="spin" />
        ) : agent.status === "completed" ? (
          <CircleCheck className="ok" />
        ) : (
          <CircleAlert className="ko" />
        )}
        <span className="name">{agent.description || "Sous-agent"}</span>
        {agent.type && <span className="type">{agent.type}</span>}
        <span className="figs">
          {elapsedLabel(elapsed)}
          {agent.tokens > 0 && ` · ${tokensLabel(agent.tokens)} jetons`}
        </span>
      </div>
      <div className="r2">
        {agent.retry ? (
          <span className="retry">
            réessaie ({agent.retry.attempt}/{agent.retry.max})
            {agent.retry.status ? ` · erreur ${agent.retry.status}` : ""}
          </span>
        ) : (
          <span className="sum" title={line}>
            {running ? line : endedLabel(agent.status)}
          </span>
        )}
        {running && summary && action && (
          <span className="act" title={action}>
            ↳ {action}
          </span>
        )}
      </div>
    </div>
  );
}

function endedLabel(status: Subagent["status"]): string {
  switch (status) {
    case "completed":
      return "terminé";
    case "failed":
      return "en échec";
    case "interrupted":
      return "interrompu";
    default:
      return "arrêté";
  }
}
