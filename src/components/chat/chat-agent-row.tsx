import { Bot, ChevronRight } from "lucide-react";
import type { Subagent } from "@/lib/chat/chatState";
import { toolSummary, type ToolItem } from "@/lib/chat/chatGroups";

const STATUS: Record<Subagent["status"], string> = {
  running: "en cours",
  completed: "fini",
  failed: "en échec",
  stopped: "arrêté",
  // Still running when its session's Claude Code stopped (a resume shows it).
  interrupted: "interrompu",
};

/** A subagent Claude started: one line, its conversation a click away. */
export function ChatAgentRow({
  tool,
  agent,
  onOpen,
}: {
  tool: ToolItem;
  agent: Subagent | undefined;
  /** Its conversation when known, else the finished agents. */
  onOpen: (agent?: Subagent) => void;
}) {
  const running = agent
    ? agent.status === "running"
    : !tool.result && !tool.stale;
  return (
    <div className="chat-unit">
      <div className="chat-line" onClick={() => onOpen(agent)}>
        {running ? <span className="spin" /> : <Bot />}
        <b>Sous-agent</b>
        <span>· {toolSummary(tool)}</span>
        <span>
          · {agent ? STATUS[agent.status] : running ? "en cours" : "fini"}
        </span>
        {agent && agent.toolUses > 0 && <span>· {agent.toolUses} outils</span>}
        <ChevronRight />
      </div>
    </div>
  );
}
