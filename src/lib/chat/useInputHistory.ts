import { useMemo, useState } from "react";
import { messageDraft } from "@/lib/chat/chatAttachments";
import type { ChatDraft } from "@/lib/chat/chatDrafts";
import { recallStep, sentHistory } from "@/lib/chat/chatInputHistory";
import { itemPastes, type ChatItem } from "@/lib/chat/chatState";

/**
 * ↑ / ↓ in the chat's input (`chatInputHistory`): from an empty input, ↑
 * brings back the pane's last message, again the one before; ↓ the other
 * way, down to empty. Typing in a recalled message ends the browsing, as do
 * the arrows off its first (↑) or last (↓) line. `recall` gets the message
 * as a draft: its attachment lines as cards, its pasted texts as tags
 * (`messageDraft`), so the input's text is the rest. `attached`: the
 * input's cards and images (`attachedKey`), which a recall replaces: a card
 * added to a recalled message ends the browsing too, so no arrow drops it.
 */
export function useInputHistory(
  items: readonly ChatItem[],
  text: string,
  recall: (draft: ChatDraft) => void,
  attached = "",
) {
  const history = useMemo(() => sentHistory(items), [items]);
  const [at, setAt] = useState<{
    index: number;
    text: string;
    attached: string;
  } | null>(null);
  const browsing = at !== null && at.text === text && at.attached === attached;
  // With the pastes the frames show as tags, after a reload too
  // (`framePastes`): read at the key, not at each event of the chat.
  const draftOf = (message: string) =>
    messageDraft(message, [], itemPastes(items));
  const shown = (step: { index: number }, draft: ChatDraft) => ({
    index: step.index,
    text: draft.text,
    attached: attachedKey(
      (draft.files ?? []).map((f) => f.path),
      0,
    ),
  });

  /** True when the key was the history's. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
    const area = e.currentTarget;
    if (e.key === "ArrowUp") {
      if ((text !== "" || attached !== "") && !browsing) return false;
      if (area.value.slice(0, area.selectionStart).includes("\n")) return false;
      const step = recallStep(history, browsing ? at.index : -1, "up");
      if (!step) return false;
      e.preventDefault();
      const draft = draftOf(step.text);
      setAt(shown(step, draft));
      recall(draft);
      return true;
    }
    if (!browsing) return false;
    if (area.value.slice(area.selectionEnd).includes("\n")) return false;
    const step = recallStep(history, at.index, "down");
    if (!step) return false;
    e.preventDefault();
    const draft = draftOf(step.text);
    setAt(step.index < 0 ? null : shown(step, draft));
    recall(draft);
    return true;
  };

  return { onKeyDown };
}

/** What `useInputHistory` compares of the input's attachments: its cards'
 *  paths, then its pasted images (none in a recalled message). */
export function attachedKey(paths: string[], images: number): string {
  return [...paths, ...(images > 0 ? [`+${images}`] : [])].join("\n");
}
