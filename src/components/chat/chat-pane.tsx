import { useEffect } from "react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatView } from "@/components/chat/chat-view";
import { folderOf } from "@/lib/chat/chatLabels";
import { useChatSession } from "@/lib/chat/useChatSession";
import type { PaneChat, PaneState } from "@/types";

/**
 * A pane showing Claude as a chat. The conversation runs in the chat server
 * and outlives this component: it ends when the pane closes or switches to
 * the terminal (the pane's owner sends that).
 */
export function ChatPane({
  pane,
  chat,
  isActive,
  switching,
  onActivate,
  onSession,
  onLabel,
  onSwitchToTerminal,
  onToast,
}: {
  pane: PaneState;
  chat: PaneChat;
  isActive: boolean;
  switching: boolean;
  onActivate: () => void;
  /** The chat's Claude session, once known (kept in the pane for later). */
  onSession: (paneId: string, sessionId: string) => void;
  /** The tab title's text (its status glyph follows the chat: `usePaneChats`). */
  onLabel: (paneId: string, label: string) => void;
  onSwitchToTerminal: (paneId: string) => void;
  onToast?: ToastFn;
}) {
  const session = useChatSession(pane.id, pane.accountId, chat);
  const { state } = session;

  useEffect(() => {
    if (state.sessionId) onSession(pane.id, state.sessionId);
  }, [state.sessionId, pane.id, onSession]);

  const label = state.title ?? folderOf(chat.cwd);
  useEffect(() => {
    onLabel(pane.id, label);
  }, [label, pane.id, onLabel]);

  return (
    <ChatView
      state={state}
      agents={session.agents}
      cwd={chat.cwd}
      isActive={isActive}
      switching={switching}
      onSwitchToTerminal={() => onSwitchToTerminal(pane.id)}
      onActivate={onActivate}
      onSend={session.send}
      onInterrupt={session.interrupt}
      onAnswer={session.answer}
      onMode={session.setMode}
      onModel={session.setModel}
      onOpenAgent={session.openAgent}
      onRestart={session.restart}
      onToast={onToast}
    />
  );
}
