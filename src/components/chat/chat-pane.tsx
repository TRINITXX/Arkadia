import { useCallback, useEffect } from "react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatView } from "@/components/chat/chat-view";
import { appendDictation, usePaneDraft } from "@/lib/chat/chatDrafts";
import { folderOf } from "@/lib/chat/chatLabels";
import { usePaneMessagesOnly } from "@/lib/chat/chatMessagesOnly";
import { useChatSession } from "@/lib/chat/useChatSession";
import { useSlashActions } from "@/lib/chat/useSlashActions";
import { useHiddenVoice } from "@/lib/useHiddenVoice";
import type { PaneChat, PaneState } from "@/types";

/**
 * A pane showing Claude as a chat. The conversation runs in the chat server
 * and outlives this component: it ends when the pane closes or switches to
 * the terminal (the pane's owner sends that). Its unsent input outlives it
 * too (`chatDrafts`), Claude's dictation included.
 */
export function ChatPane({
  pane,
  chat,
  isActive,
  switching,
  onActivate,
  onSession,
  onLabel,
  liveSessions,
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
  /** Sessions running in the other panes: /resume can't take them. */
  liveSessions: (exceptPaneId: string) => Promise<Set<string>>;
  onSwitchToTerminal: (paneId: string) => void;
  onToast?: ToastFn;
}) {
  const session = useChatSession(pane.id, pane.accountId, chat);
  const { state } = session;
  const [draft, setDraft] = usePaneDraft(pane.id);
  const [messagesOnly, setMessagesOnly] = usePaneMessagesOnly(pane.id);
  // A dictation still lands in this pane's draft if the pane unmounted
  // meanwhile (another project on screen).
  const paneId = pane.id;
  const append = useCallback(
    (dictated: string) => appendDictation(paneId, dictated),
    [paneId],
  );
  const voice = useHiddenVoice(append);

  const { error: voiceError, clearError } = voice;
  useEffect(() => {
    if (!voiceError) return;
    onToast?.("error", voiceError);
    clearError();
  }, [voiceError, clearError, onToast]);

  // The input stops a recording when it goes (`ChatComposer`); a hidden tab
  // keeps it mounted, so the view says when it stops showing.
  const { status: voiceStatus, stop: stopVoice } = voice;
  const recording = voiceStatus === "listening" || voiceStatus === "starting";
  const onHidden = useCallback(() => {
    if (recording) void stopVoice();
  }, [recording, stopVoice]);

  useEffect(() => {
    if (state.sessionId) onSession(pane.id, state.sessionId);
  }, [state.sessionId, pane.id, onSession]);

  const label = state.title ?? folderOf(chat.cwd);
  useEffect(() => {
    onLabel(pane.id, label);
  }, [label, pane.id, onLabel]);

  const onSlashError = useCallback(
    (message: string) => onToast?.("error", message),
    [onToast],
  );
  const slashActions = useSlashActions(
    pane.id,
    pane.accountId,
    onSlashError,
    liveSessions,
  );

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
      draft={draft}
      onDraft={setDraft}
      voice={voice}
      messagesOnly={messagesOnly}
      onMessagesOnly={setMessagesOnly}
      onHidden={onHidden}
      onToast={onToast}
      slashActions={slashActions}
    />
  );
}
