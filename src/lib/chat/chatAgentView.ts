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

/**
 * Whether a sheet fed by its agent's transcript reads it once more: the
 * refresh stops with the agent, and its report and its last call's result
 * are written after the latest read. `ran`: the agent the sheet saw running,
 * kept until that read is made. `ready`: the sheet may ask now (shown, not
 * fed live); an end met meanwhile is read once it is. An agent opened
 * already ended was read on open: no other read.
 */
export function readAtEnd(
  ran: string | null,
  taskId: string | undefined,
  running: boolean,
  ready: boolean,
): { ran: string | null; read: boolean } {
  if (!taskId) return { ran: null, read: false };
  if (running) return { ran: taskId, read: false };
  if (ran !== taskId) return { ran: null, read: false };
  return ready ? { ran: null, read: true } : { ran, read: false };
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
          : // Cut with its workflow: as its workflow ended (« interrompu »,
            // « arrêté »), not « en échec ».
            (agent.endedBy ?? "failed"),
    toolUses: agent.toolCalls ?? 0,
    tokens: agent.tokens ?? 0,
    durationMs: agent.durationMs ?? 0,
  };
}

/**
 * The snapshot a sheet falls back on once its agent is gone from the chat
 * (`currentAgent`): the agent as last seen under another status, so as it
 * ended, not as it was when opened. Its figures move every second while it
 * runs: the snapshot follows its status alone.
 */
export function agentSnapshot(kept: Subagent, now: Subagent): Subagent {
  return now.status === kept.status ? kept : now;
}

/**
 * An agent's sheet as the agent is now (its figures move): the chat's
 * subagent, else a workflow's agent, else as its sheet last kept it
 * (`agentSnapshot`). Kept running and gone from the chat (its workflow ran
 * again without it), it runs no more: « interrompu ».
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
  return opened.status === "running"
    ? { ...opened, status: "interrupted" }
    : opened;
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
