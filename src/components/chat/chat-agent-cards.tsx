import { useState } from "react";
import { CircleAlert, CircleCheck, OctagonX } from "lucide-react";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import { toolStep } from "@/lib/chat/chatSteps";
import { useChatLayer } from "@/lib/chat/useChatLayers";

/**
 * The running subagents, one live card each, docked above the input (the
 * user's pick of 30/10/2026): what it does in a line (its progress summary,
 * else its description), its type, time, tokens and last action. A card
 * that ends shows ✓ a moment, then leaves (`agentCards`). A click opens its
 * conversation. A running one stops from its card (the user's ask of
 * 31/10/2026), behind a confirmation: `stopTask`, as the workflow's stop.
 */
export function ChatAgentCards({
  agents,
  cwd,
  now,
  onOpen,
  onStop,
}: {
  /** Already filtered: running, or just ended (`agentCards`). */
  agents: Subagent[];
  cwd: string | null;
  now: number;
  onOpen: (agent: Subagent) => void;
  /** Stops a running subagent (its task id); absent, no stop button. */
  onStop?: (taskId: string) => void;
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
          onStop={onStop && (() => onStop(agent.taskId))}
        />
      ))}
    </div>
  );
}

/** A stop sent and the agent still running this long: the button again. */
const STOP_RETRY_MS = 10_000;

/** The card's stop: asked, or sent (when, to which run of the agent). */
type StopState =
  | { step: "ask" }
  | { step: "sent"; at: number; run: number | undefined }
  | null;

function AgentCard({
  agent,
  cwd,
  now,
  onOpen,
  onStop,
}: {
  agent: Subagent;
  cwd: string | null;
  now: number;
  onOpen: () => void;
  onStop?: () => void;
}) {
  const running = agent.status === "running";
  // « Arrêter ce sous-agent ? » asked, then the stop sent: until it ends.
  const [stop, setStop] = useState<StopState>(null);
  const asking = running && stop?.step === "ask";
  // No end within STOP_RETRY_MS (the stop failed or went unheard), or the
  // agent run again (SendMessage, same card): the button is back.
  const stopping =
    running &&
    stop?.step === "sent" &&
    stop.run === agent.startedAt &&
    now - stop.at < STOP_RETRY_MS;
  // Esc drops the question, never Claude's turn (`chatLayers`).
  useChatLayer(asking, () => setStop(null));
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
          {agent.tokens > 0 && ` · ${tokensLabel(agent.tokens)} tokens`}
        </span>
        {running && onStop && !asking && !stopping && (
          <button
            type="button"
            className="chat-agent-stop"
            title="Arrêter ce sous-agent"
            aria-label="Arrêter ce sous-agent"
            onClick={(e) => {
              e.stopPropagation();
              setStop({ step: "ask" });
            }}
          >
            <OctagonX />
          </button>
        )}
      </div>
      {asking && onStop ? (
        <div className="chat-agent-ask" onClick={(e) => e.stopPropagation()}>
          <span>Arrêter ce sous-agent ?</span>
          <button
            type="button"
            className="chat-btn danger"
            onClick={() => {
              setStop({ step: "sent", at: now, run: agent.startedAt });
              onStop();
            }}
          >
            Oui, arrêter
          </button>
          <button
            type="button"
            className="chat-btn"
            onClick={() => setStop(null)}
          >
            Annuler
          </button>
        </div>
      ) : (
        <div className="r2">
          {stopping ? (
            <span className="sum">arrêt demandé…</span>
          ) : agent.retry ? (
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
      )}
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
