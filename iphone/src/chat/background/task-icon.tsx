import { ActivityIndicator } from "react-native";
import { SymbolView } from "expo-symbols";
import type { Subagent } from "@/lib/chat/chatState";
import type { WorkflowAgent } from "@/lib/chat/chatTasks";
import { C } from "~/chat/chat-theme";

/** What an agent's icon says: at work, done, waiting its turn, or not done. */
export type TaskTone = "running" | "ok" | "queued" | "ko";

export const subagentTone = (agent: Subagent): TaskTone =>
  agent.status === "running"
    ? "running"
    : agent.status === "completed"
      ? "ok"
      : "ko";

export const workflowAgentTone = (agent: WorkflowAgent): TaskTone =>
  agent.state === "running"
    ? "running"
    : agent.state === "done"
      ? "ok"
      : agent.state === "queued"
        ? "queued"
        : "ko";

/**
 * The desktop's spinner, ✓ or alert of an agent pill, a workflow and its
 * agents (`chat-agent-cards.tsx`, `chat-workflow-card.tsx`).
 */
export function TaskIcon({
  tone,
  size = 13,
}: {
  tone: TaskTone;
  size?: number;
}) {
  if (tone === "running")
    return (
      <ActivityIndicator
        size="small"
        color={C.accent}
        style={{ width: size, height: size, transform: [{ scale: 0.7 }] }}
      />
    );
  return (
    <SymbolView
      name={
        tone === "ok"
          ? "checkmark.circle.fill"
          : tone === "queued"
            ? "circle.dashed"
            : "exclamationmark.circle.fill"
      }
      size={size}
      tintColor={tone === "ok" ? C.ok : tone === "queued" ? C.mute : C.bad}
    />
  );
}
