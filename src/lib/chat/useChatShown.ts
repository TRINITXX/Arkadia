import { createContext, useContext } from "react";

/**
 * Whether the chat's pane is on screen (`ChatView`): a hidden tab keeps its
 * pane mounted, so every clock of the pane asks this before it ticks (live
 * line, status bar, shells), and stops while hidden. `ChatView`'s own hooks
 * sit above the provider: they get `shown` as an argument (cards, an
 * agent's sheet). Back on screen, they tick again from the time it is.
 */
export const ChatShownContext = createContext(true);

export function useChatShown(): boolean {
  return useContext(ChatShownContext);
}
