import { Bot, ChevronRight } from "lucide-react";
import type { Subagent } from "@/lib/chat/chatState";
import { toolSummary, type ToolItem } from "@/lib/chat/chatGroups";

const STATUS: Record<Subagent["status"], string> = {
  running: "en cours",
  completed: "fini",
  failed: "en échec",
  stopped: "arrêté",
};

/** A subagent Claude started: one line, its details in the drawer. */
export function ChatAgentRow({
  tool,
  agent,
  onOpen,
}: {
  tool: ToolItem;
  agent: Subagent | undefined;
  onOpen: () => void;
}) {
  const running = agent ? agent.status === "running" : !tool.result;
  return (
    <div className="chat-unit">
      <div className="chat-line" onClick={onOpen}>
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
