import { useEffect, useState } from "react";
import { subscribeChat } from "@/lib/chat/chatEvents";

/** The end of a background shell's output, as Claude Code keeps it (8 KiB). */
export interface ShellOutput {
  output: string;
  truncated: boolean;
  error?: string;
}

/**
 * The `task_output` answers of a chat, by task id: the shells list asks
 * while it is open (`ChatShellsChip`), the answers land here. Not in the
 * chat's state: they change every second and no replay needs them.
 */
export function useShellOutputs(chatId: string): Record<string, ShellOutput> {
  const [outputs, setOutputs] = useState<Record<string, ShellOutput>>({});
  useEffect(
    () =>
      subscribeChat(chatId, (event) => {
        if (event.type !== "task_output") return;
        const { taskId, output, truncated, error } = event;
        setOutputs((prev) => {
          const known = prev[taskId];
          if (known?.output === output && known.error === error) return prev;
          return { ...prev, [taskId]: { output, truncated, error } };
        });
      }),
    [chatId],
  );
  return outputs;
}
