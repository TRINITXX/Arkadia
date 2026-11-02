import type { ChatState } from "@/lib/chat/chatState";
import { useRoundShown } from "~/chat/asks/round-store";

/**
 * What hides the composer, as on the desktop: a request of Claude Code or
 * of an MCP server takes the field's place, the status row staying under
 * it (`!inInput && chat-status-row` of `chat-view.tsx`); the round's sheet
 * unfolded hides it all (`sheet-open`), folded or closed it comes back.
 * Either way its microphone stops and the keyboard goes; the draft
 * outlives both.
 */
export type ComposerCover = "request" | "round" | null;

export function useAsksCoverComposer(
  chatId: string,
  state: Pick<
    ChatState,
    "closed" | "requests" | "sdk" | "working" | "items" | "restRound"
  >,
): ComposerCover {
  const shown = useRoundShown(chatId, state);
  if (state.closed) return null;
  // The desktop's order (`phoneAsk`): a request before the round.
  if (state.requests.length > 0 || state.sdk.elicitations.length > 0)
    return "request";
  return shown.length > 0 ? "round" : null;
}
