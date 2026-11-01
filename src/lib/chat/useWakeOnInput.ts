import { useEffect, useRef } from "react";
import type { ChatDraft } from "@/lib/chat/chatDrafts";

/**
 * A chat asleep wakes on the first change to its input (a key, a paste, a
 * dictation that lands): its Claude Code starts while the user goes on
 * typing, and is up by the time the message goes. The draft found at mount
 * (kept on disk, another pane's) wakes nothing.
 */
export function useWakeOnInput(
  asleep: boolean,
  draft: ChatDraft,
  onWake?: () => void,
): void {
  const seen = useRef(draft);
  useEffect(() => {
    if (draft === seen.current) return;
    seen.current = draft;
    if (asleep) onWake?.();
  }, [asleep, draft, onWake]);
}
