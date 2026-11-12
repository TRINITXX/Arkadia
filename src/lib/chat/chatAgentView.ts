import type { JsonObject } from "@/lib/chat/chatProtocol";
import {
  EMPTY_CHAT,
  reduceChat,
  type ChatItem,
  type ChatState,
  type Subagent,
} from "@/lib/chat/chatState";
import type { BackgroundShell, WorkflowAgent } from "@/lib/chat/chatTasks";

/**
 * What the agent cards open: a subagent's conversation, built from its live
 * messages while this chat ran it (`forwardSubagentText`), else read from its
 * transcript; and the command line behind each background shell.
 */

/**
 * A live subagent's own messages as the conversation its sheet shows. A
 * background agent's prompt isn't streamed: its Agent call's is put first.
 */
export function agentConversation(
  messages: JsonObject[],
  prompt?: string,
): ChatState {
  // A foreground agent's prompt comes as its first message, a text.
  const prompted = messages.some((m) => {
    const content = obj(m.message).content;
    return (
      m.type === "user" &&
      (typeof content === "string" ||
        (Array.isArray(content) && content.some((b) => obj(b).type === "text")))
    );
  });
  const first: JsonObject[] =
    prompt && !prompted
      ? [{ type: "user", uuid: "agent-prompt", message: { content: prompt } }]
      : [];
  return reduceChat(
    EMPTY_CHAT,
    {
      type: "history",
      chatId: "",
      // Its messages read as the main loop's: the column's own builder.
      messages: [...first, ...messages].map((m) => ({
        ...m,
        parent_tool_use_id: null,
      })),
      truncated: false,
    },
    0,
  );
}

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};

/**
 * A running agent's conversation: its calls left without a result run. Read
 * as a past (live messages or transcript, both through `history`), they came
 * out `stale`, and the call under way said « (sans résultat) ».
 */
export function withRunningCalls(conversation: ChatState): ChatState {
  const held = (x: ChatItem) =>
    x.kind === "tool" && !x.result && x.stale === true;
  if (!conversation.items.some(held)) return conversation;
  return {
    ...conversation,
    items: conversation.items.map((x) =>
      x.kind === "tool" && held(x) ? { ...x, stale: false } : x,
    ),
  };
}

/** A workflow agent as the sheet takes it: its conversation is its transcript. */
export function workflowAgentSubagent(agent: WorkflowAgent): Subagent {
  return {
    taskId: agent.agentId,
    description: agent.label,
    status:
      agent.state === "running" || agent.state === "queued"
        ? "running"
        : agent.state === "done"
          ? "completed"
          : "failed",
    toolUses: agent.toolCalls ?? 0,
    tokens: agent.tokens ?? 0,
    durationMs: agent.durationMs ?? 0,
  };
}

/**
 * An agent's sheet as the agent is now (its figures move): the chat's
 * subagent, else a workflow's agent, else as it was opened.
 */
export function currentAgent(
  state: Pick<ChatState, "subagents" | "workflows">,
  opened: Subagent,
): Subagent {
  const live = state.subagents.find((s) => s.taskId === opened.taskId);
  if (live) return live;
  for (const wf of state.workflows) {
    const a = wf.agents.find((x) => x.agentId === opened.taskId);
    if (a) return workflowAgentSubagent(a);
  }
  return opened;
}

/**
 * Each shell's command line, by task id, from the Bash call that started it:
 * the main loop's (a column item) or a subagent's (its live messages).
 */
export function shellCommands(
  shells: BackgroundShell[],
  items: ChatItem[],
  agentMessages: Record<string, JsonObject[]>,
): Record<string, string> {
  const wanted = new Map(
    shells.flatMap((s) => (s.toolUseId ? [[s.toolUseId, s.taskId]] : [])),
  );
  const found: Record<string, string> = {};
  if (wanted.size === 0) return found;
  const take = (id: unknown, input: unknown) => {
    const taskId = typeof id === "string" ? wanted.get(id) : undefined;
    const command = (input as { command?: unknown } | null)?.command;
    if (taskId && typeof command === "string") found[taskId] = command;
  };
  for (const item of items) if (item.kind === "tool") take(item.id, item.input);
  for (const messages of Object.values(agentMessages)) {
    for (const m of messages) {
      const content = (m.message as { content?: unknown } | undefined)?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content as JsonObject[]) {
        if (b?.type === "tool_use") take(b.id, b.input);
      }
    }
  }
  return found;
}
