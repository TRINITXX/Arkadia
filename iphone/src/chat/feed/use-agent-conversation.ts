import { useEffect, useMemo } from "react";
import {
  agentConversation,
  currentAgent,
  withRunningCalls,
} from "@/lib/chat/chatAgentView";
import type { ChatState, Subagent } from "@/lib/chat/chatState";

/** A running subagent's transcript is read again this often while shown. */
const REFRESH_MS = 2_000;

/**
 * A subagent's conversation, as the desktop's sheet builds it
 * (`useAgentSheet`): from its live messages while this chat runs it, so it
 * follows the agent as it works; else from its transcript (`agent_history`,
 * `PhoneChatLive.agents`), asked on open and every 2 s while it runs. The
 * ask on open is the user's (a finished chat's agents read too); the
 * refresh, the app's own, waits on a running chat.
 */
export function useAgentConversation(
  state: ChatState,
  agents: Record<string, ChatState>,
  opened: Subagent | null,
  openAgent: (agentId: string, quiet?: boolean) => void,
  /** Its sheet is up: nothing is asked while it isn't. */
  shown: boolean,
  /** The chat runs, its server too (`useChatReadable`): else no refresh. */
  readable: boolean,
) {
  // The opened agent as it is now (a workflow's too): its figures move.
  const { subagents, workflows } = state;
  const agent = useMemo(
    () => (opened ? currentAgent({ subagents, workflows }, opened) : null),
    [opened, subagents, workflows],
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
  const read = streamed ?? (agent ? agents[agent.taskId] : undefined);

  const taskId = agent?.taskId;
  const running = agent?.status === "running";
  // At work: its call under way runs, « En cours… » (`withRunningCalls`).
  const conversation = useMemo(
    () => (read && running ? withRunningCalls(read) : read),
    [read, running],
  );
  const live = streamed !== undefined;
  useEffect(() => {
    if (taskId && shown) openAgent(taskId);
  }, [taskId, shown, openAgent]);
  // Never to a chat ended, asleep or whose server stopped: Rust would start
  // its server again every 2 s.
  useEffect(() => {
    if (!taskId || !running || live || !shown || !readable) return;
    const id = setInterval(() => openAgent(taskId, true), REFRESH_MS);
    return () => clearInterval(id);
  }, [taskId, running, live, shown, readable, openAgent]);

  return { agent, conversation };
}
