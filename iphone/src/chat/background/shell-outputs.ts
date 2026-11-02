import { useCallback, useSyncExternalStore } from "react";
import type { ChatEvent } from "@/lib/chat/chatProtocol";

/**
 * The `task_output` answers of each chat, by task id: the shells sheet asks
 * every second while it is open, the answers land here (`chat-store` routes
 * them). Out of the chat's state, as the desktop's `useShellOutputs`: they
 * change every second, and the whole chat screen would draw again with them.
 */

type OutputEvent = Extract<ChatEvent, { type: "task_output" }>;

/** The end of a shell's output, as the desktop's `ShellOutput` (8 KiB). */
export type ShellOutput = Pick<OutputEvent, "output" | "truncated" | "error">;

type Outputs = Record<string, ShellOutput>;

const outputs = new Map<string, Outputs>();
const listeners = new Map<string, Set<() => void>>();
const NONE: Outputs = {};

export function putShellOutput(event: OutputEvent): void {
  const { chatId, taskId, output, truncated, error } = event;
  const prev = outputs.get(chatId) ?? NONE;
  const known = prev[taskId];
  // The same tail as the second before: nothing to draw.
  if (known?.output === output && known.error === error) return;
  outputs.set(chatId, { ...prev, [taskId]: { output, truncated, error } });
  for (const cb of listeners.get(chatId) ?? []) cb();
}

export function useShellOutputs(chatId: string): Outputs {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(chatId);
      if (!set) {
        set = new Set();
        listeners.set(chatId, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0) listeners.delete(chatId);
      };
    },
    [chatId],
  );
  return useSyncExternalStore(subscribe, () => outputs.get(chatId) ?? NONE);
}
