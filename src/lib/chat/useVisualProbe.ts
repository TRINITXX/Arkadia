import { useEffect } from "react";
import {
  chatCommandFor,
  chatReplaying,
  subscribeEveryChat,
} from "@/lib/chat/chatEvents";
import { createVisualProbe } from "@/lib/chat/chatVisualDom";

/**
 * Checks every chat's new visuals, shown or not (`createVisualProbe`): one
 * probe for the page's life, mounted by the app beside the chats' watches.
 * Its report goes to the chat's server, which answers Claude with it.
 */
export function useVisualProbe(): void {
  useEffect(() => {
    const onEvent = createVisualProbe((chatId, checkId, report) => {
      void chatCommandFor(chatId, {
        type: "visual_report",
        chatId,
        checkId,
        report,
      }).catch(() => {});
    });
    return subscribeEveryChat((event) =>
      onEvent(event, "chatId" in event && !!event.chatId && chatReplaying(event.chatId)),
    );
  }, []);
}
