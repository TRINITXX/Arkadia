import { Bot, ChevronRight } from "lucide-react";
import type { Subagent } from "@/lib/chat/chatState";
import { toolRunning, toolSummary, type ToolItem } from "@/lib/chat/chatGroups";

const STATUS: Record<Subagent["status"], string> = {
  running: "en cours",
  completed: "fini",
  failed: "en échec",
  stopped: "arrêté",
  // Still running when its session's Claude Code stopped (a resume shows it).
  interrupted: "interrompu",
};

/**
 * A subagent Claude started: one line, its conversation a click away. No
 * spinner while it runs: its card and the live line above the input say it.
 * An agent not known (an older page, before its `task_started`) has no
 * conversation to open: its line takes no click.
 */
export function ChatAgentRow({
  tool,
  agent,
  onOpen,
}: {
  tool: ToolItem;
  agent: Subagent | undefined;
  onOpen: (agent: Subagent) => void;
}) {
  const running = agent ? agent.status === "running" : toolRunning(tool);
  return (
    <div className="chat-unit">
      <div
        className={agent ? "chat-line" : "chat-line static"}
        onClick={agent ? () => onOpen(agent) : undefined}
      >
        <Bot />
        <b>Sous-agent</b>
        <span>· {toolSummary(tool)}</span>
        <span>
          · {agent ? STATUS[agent.status] : running ? "en cours" : "fini"}
        </span>
        {agent && agent.toolUses > 0 && <span>· {agent.toolUses} outils</span>}
        {agent && <ChevronRight />}
      </div>
    </div>
  );
}
