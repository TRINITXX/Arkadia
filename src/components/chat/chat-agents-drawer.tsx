import { Bot, CircleAlert, CircleCheck, MessagesSquare, X } from "lucide-react";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";

/** The chat's subagents: what each does, how far it got, its conversation a click away. */
export function ChatAgentsDrawer({
  subagents,
  onOpenConversation,
  onClose,
}: {
  subagents: Subagent[];
  onOpenConversation: (agent: Subagent) => void;
  onClose: () => void;
}) {
  return (
    <div className="chat-drawer">
      <div className="dh">
        <Bot size={16} />
        <span>Sous-agents</span>
        <button
          type="button"
          className="chat-ib"
          title="Fermer"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <div className="db">
        {subagents.length === 0 && (
          <div className="chat-agent">
            <span className="meta">
              Aucun sous-agent dans cette conversation.
            </span>
          </div>
        )}
        {[...subagents].reverse().map((agent) => (
          <div key={agent.taskId} className="chat-agent">
            <div className="top">
              {agent.status === "running" ? (
                <span className="chat-line" style={{ padding: 0 }}>
                  <span className="spin" />
                </span>
              ) : agent.status === "completed" ? (
                <CircleCheck className="ok" />
              ) : (
                <CircleAlert className="ko" />
              )}
              <span className="d">{agent.description}</span>
            </div>
            <div className="meta">
              {[
                agent.type,
                agent.toolUses > 0 && `${agent.toolUses} outils`,
                agent.tokens > 0 && `${tokensLabel(agent.tokens)} jetons`,
                agent.durationMs > 0 && elapsedLabel(agent.durationMs),
                agent.status === "running" &&
                  agent.lastTool &&
                  `dernier outil : ${agent.lastTool}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {agent.summary && agent.status !== "running" && (
              <div className="sum">{agent.summary}</div>
            )}
            <div>
              <button
                type="button"
                className="chat-btn"
                onClick={() => onOpenConversation(agent)}
              >
                <MessagesSquare /> Ouvrir sa conversation
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
