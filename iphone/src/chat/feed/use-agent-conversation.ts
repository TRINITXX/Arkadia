import { useEffect, useMemo } from "react";
import { agentConversation } from "@/lib/chat/chatAgentView";
import type { ChatState, Subagent } from "@/lib/chat/chatState";

/** A running subagent's transcript is read again this often while shown. */
const REFRESH_MS = 2_000;

/**
 * A subagent's conversation, as the desktop's sheet builds it
 * (`useAgentSheet`): from its live messages while this chat runs it, so it
 * follows the agent as it works; else from its transcript (`agent_history`,
 * `PhoneChatLive.agents`), asked on open and every 2 s while it runs.
 */
export function useAgentConversation(
  state: ChatState,
  agents: Record<string, ChatState>,
  opened: Subagent | null,
  openAgent: (agentId: string) => void,
  /** Its sheet is up: nothing is asked while it isn't. */
  shown: boolean,
) {
  // The opened agent as it is now: its figures move.
  const agent = useMemo(
    () =>
      opened
        ? (state.subagents.find((s) => s.taskId === opened.taskId) ?? opened)
        : null,
    [opened, state.subagents],
  );
  const toolUseId = agent?.toolUseId;
  const messages = toolUseId ? state.agentMessages[toolUseId] : undefined;
  // Its Agent call's prompt: a background agent's isn't streamed.
  const prompt = useMemo(() => {
    const call = state.items.find((x) => x.id === toolUseId);
    const text = call?.kind === "tool" ? call.input.prompt : undefined;
    return typeof text === "string" ? text : undefined;
  }, [state.items, toolUseId]);
  const streamed = useMemo(
    () => (messages?.length ? agentConversation(messages, prompt) : undefined),
    [messages, prompt],
  );
  const conversation = streamed ?? (agent ? agents[agent.taskId] : undefined);

  const taskId = agent?.taskId;
  const running = agent?.status === "running";
  const live = streamed !== undefined;
  useEffect(() => {
    if (taskId && shown) openAgent(taskId);
  }, [taskId, shown, openAgent]);
  useEffect(() => {
    if (!taskId || !running || live || !shown) return;
    const id = setInterval(() => openAgent(taskId), REFRESH_MS);
    return () => clearInterval(id);
  }, [taskId, running, live, shown, openAgent]);

  return { agent, conversation };
}
