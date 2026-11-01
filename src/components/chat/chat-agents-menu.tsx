import { useEffect, useRef, useState } from "react";
import { Bot, CircleAlert, CircleCheck } from "lucide-react";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";

/** The pointer crosses the gap to the menu within this, without it closing. */
const CLOSE_AFTER_MS = 180;

const ENDED: Partial<Record<Subagent["status"], string>> = {
  failed: "en échec",
  stopped: "arrêté",
  interrupted: "interrompu",
};

/**
 * « Agents terminés (N) » in the live line: hovered, a menu of them, each
 * with its title, a line of its summary, its time and tokens; a click opens
 * its conversation (the user's pick B of 01/11/2026, in place of the panel
 * that listed them on the right).
 */
export function ChatAgentsMenu({
  agents,
  onOpen,
}: {
  agents: Subagent[];
  onOpen: (agent: Subagent) => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_AFTER_MS);
  };
  return (
    <span className="chat-anchor" onMouseEnter={show} onMouseLeave={hide}>
      <span className="chat-agents-done">
        <Bot /> Agents terminés ({agents.length})
      </span>
      {open && (
        <div className="chat-menu chat-agents-menu" style={{ left: 0 }}>
          {[...agents].reverse().map((agent) => {
            const ok = agent.status === "completed";
            const meta = [
              ENDED[agent.status],
              agent.durationMs > 0 && elapsedLabel(agent.durationMs),
              agent.tokens > 0 && `${tokensLabel(agent.tokens)} tokens`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={agent.taskId}
                type="button"
                title="Ouvrir sa conversation"
                onClick={() => {
                  setOpen(false);
                  onOpen(agent);
                }}
              >
                <span className="h">
                  {ok ? (
                    <CircleCheck className="ok" />
                  ) : (
                    <CircleAlert className="ko" />
                  )}
                  <b>{agent.description}</b>
                </span>
                {agent.summary && <span className="s">{agent.summary}</span>}
                {meta && <span className="m">{meta}</span>}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
