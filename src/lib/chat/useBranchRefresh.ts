import { useEffect } from "react";
import { chatCommand } from "@/lib/chat/chatEvents";

/**
 * The status bar's git branch, looked at again when the pane shows (its tab
 * back, its project back) and when the window comes back to the front, the
 * branch maybe changed elsewhere. The server never polls it: a hidden or
 * idle chat costs nothing (it also looks at each turn's end).
 */
export function useBranchRefresh(
  chatId: string,
  accountId: string | undefined,
  shown: boolean,
): void {
  useEffect(() => {
    if (!shown) return;
    const refresh = () =>
      void chatCommand(accountId, { type: "refresh_branch", chatId }).catch(
        () => {},
      );
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [chatId, accountId, shown]);
}
