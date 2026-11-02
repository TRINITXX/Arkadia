import type { ChatState } from "@/lib/chat/chatState";
import { useRoundShown } from "~/chat/asks/round-store";

/**
 * Whether the asks take the composer's place, as on the desktop: a request
 * of Claude Code or of an MCP server replaces the input card, and the
 * round's sheet unfolded hides it (folded or closed, it comes back). The
 * composer's draft outlives it.
 */
export function useAsksCoverComposer(
  chatId: string,
  state: Pick<
    ChatState,
    "closed" | "requests" | "sdk" | "working" | "items" | "restRound"
  >,
): boolean {
  const shown = useRoundShown(chatId, state);
  if (state.closed) return false;
  return (
    state.requests.length > 0 ||
    state.sdk.elicitations.length > 0 ||
    shown.length > 0
  );
}
