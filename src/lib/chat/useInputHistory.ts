import { useMemo, useState } from "react";
import { recallStep, sentHistory } from "@/lib/chat/chatInputHistory";
import type { ChatItem } from "@/lib/chat/chatState";

/**
 * ↑ / ↓ in the chat's input (`chatInputHistory`): from an empty input, ↑
 * brings back the pane's last message, again the one before; ↓ the other
 * way, down to empty. Typing in a recalled message ends the browsing, as do
 * the arrows off its first (↑) or last (↓) line.
 */
export function useInputHistory(
  items: readonly ChatItem[],
  text: string,
  setText: (text: string) => void,
) {
  const history = useMemo(() => sentHistory(items), [items]);
  const [at, setAt] = useState<{ index: number; text: string } | null>(null);
  const browsing = at !== null && at.text === text;

  /** True when the key was the history's. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
    const area = e.currentTarget;
    if (e.key === "ArrowUp") {
      if (text !== "" && !browsing) return false;
      if (area.value.slice(0, area.selectionStart).includes("\n")) return false;
      const step = recallStep(history, browsing ? at.index : -1, "up");
      if (!step) return false;
      e.preventDefault();
      setAt(step);
      setText(step.text);
      return true;
    }
    if (!browsing) return false;
    if (area.value.slice(area.selectionEnd).includes("\n")) return false;
    const step = recallStep(history, at.index, "down");
    if (!step) return false;
    e.preventDefault();
    setAt(step.index < 0 ? null : step);
    setText(step.text);
    return true;
  };

  return { onKeyDown };
}
