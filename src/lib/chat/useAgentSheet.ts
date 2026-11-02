import { useCallback, useEffect, useMemo, useState } from "react";
import {
  agentConversation,
  currentAgent,
  workflowAgentSubagent,
} from "@/lib/chat/chatAgentView";
import type { ChatState, Subagent } from "@/lib/chat/chatState";
import type { WorkflowAgent } from "@/lib/chat/chatTasks";

/** A running workflow agent's transcript is read again this often while shown. */
const REFRESH_MS = 2_000;

/**
 * The agent whose conversation is open over the chat, from a card, the
 * workflow card or the drawer. A subagent this chat ran shows from its live
 * messages (`agentMessages`), so it follows the agent as it works; any other
 * (a resumed session's, a workflow's) from its transcript, read again every
 * 2 s while it runs and its tab shows.
 */
export function useAgentSheet(
  state: ChatState,
  agents: Record<string, ChatState>,
  onOpenAgent: (agentId: string) => void,
  /** Its tab on screen: hidden, the transcript isn't read again. */
  shown = true,
) {
  const [opened, setOpened] = useState<Subagent | null>(null);
  // The opened agent as it is now: its card's figures move.
  const { subagents, workflows } = state;
  const sheet = useMemo(
    () => (opened ? currentAgent({ subagents, workflows }, opened) : null),
    [opened, subagents, workflows],
  );

  const messages = sheet?.toolUseId
    ? state.agentMessages[sheet.toolUseId]
    : undefined;
  // Its Agent call's prompt: a background agent's isn't streamed.
  const toolUseId = sheet?.toolUseId;
  const prompt = useMemo(() => {
    const call = state.items.find((x) => x.id === toolUseId);
    const text = call?.kind === "tool" ? call.input.prompt : undefined;
    return typeof text === "string" ? text : undefined;
  }, [state.items, toolUseId]);
  const liveConversation = useMemo(
    () => (messages?.length ? agentConversation(messages, prompt) : undefined),
    [messages, prompt],
  );
  const conversation =
    liveConversation ?? (sheet ? agents[sheet.taskId] : undefined);

  const running = sheet?.status === "running";
  const streamed = liveConversation !== undefined;
  const taskId = sheet?.taskId;
  useEffect(() => {
    if (!taskId || !running || streamed || !shown) return;
    const id = window.setInterval(() => onOpenAgent(taskId), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [taskId, running, streamed, shown, onOpenAgent]);

  const openSheet = useCallback(
    (agent: Subagent) => {
      if (!agent.taskId) return;
      // Its transcript too: a live one may predate this page's log.
      onOpenAgent(agent.taskId);
      setOpened(agent);
    },
    [onOpenAgent],
  );
  const openWorkflowAgent = useCallback(
    (agent: WorkflowAgent) => openSheet(workflowAgentSubagent(agent)),
    [openSheet],
  );
  const close = useCallback(() => setOpened(null), []);
  return { sheet, conversation, openSheet, openWorkflowAgent, close };
}
