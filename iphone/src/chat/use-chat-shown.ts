import { useChatOnTop } from "~/remote/connection";
import { useAppActive } from "~/ui/use-app-active";

/**
 * Whether this chat's screen is in sight: the app in front, and the screen
 * the topmost one (a terminal or another chat pushed over it gets the
 * stream, `topStreams`). Every clock or poll of the chat stops otherwise,
 * as a desktop pane's in a hidden tab (`useChatShown` of `src/lib/chat`).
 */
export function useChatShown(chatId: string): boolean {
  const active = useAppActive();
  const onTop = useChatOnTop(chatId);
  return active && onTop;
}
