import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatView } from "@/components/chat/chat-view";
import {
  appendDictation,
  redirectDictation,
  usePaneDraft,
} from "@/lib/chat/chatDrafts";
import { folderOf } from "@/lib/chat/chatLabels";
import { usePaneMessagesOnly } from "@/lib/chat/chatMessagesOnly";
import { startupPhase } from "@/lib/chat/chatStartup";
import { useBranchRefresh } from "@/lib/chat/useBranchRefresh";
import { useChatSdkActions } from "@/lib/chat/useChatSdkActions";
import { useChatSession } from "@/lib/chat/useChatSession";
import { useShellOutputs } from "@/lib/chat/useShellOutputs";
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
  onActivate,
  onSession,
  onLabel,
  liveSessions,
  onToast,
  shown = true,
  onUserInput,
}: {
  pane: PaneState;
  chat: PaneChat;
  isActive: boolean;
  /** Its tab is the one on screen: hidden, the pane rests (no clock, no render per event). */
  shown?: boolean;
  onActivate: () => void;
  /** The chat's Claude session, once known (kept in the pane for later). */
  onSession: (paneId: string, sessionId: string) => void;
  /** The tab title's text (its status glyph follows the chat: `usePaneChats`). */
  onLabel: (paneId: string, label: string) => void;
  /** Sessions running in the other panes: /resume can't take them. */
  liveSessions: (exceptPaneId: string) => Promise<Set<string>>;
  onToast?: ToastFn;
  /** The user started on it (typed, or a conversation came): its project
   *  goes to « Actifs », as typing in a terminal does. */
  onUserInput?: () => void;
}) {
  const session = useChatSession(pane.id, pane.accountId, chat, shown);
  const shellOutputs = useShellOutputs(pane.id);
  const { state } = session;
  // Never for an ended chat: a command would start its server for nothing.
  useBranchRefresh(pane.id, pane.accountId, shown && !state.closed);
  const [draft, setDraft] = usePaneDraft(pane.id);
  // The user started on it, after it showed: a letter typed, or a chat
  // opened asleep that got its session (a conversation picked, a message
  // sent). Its project goes to « Actifs » once, as a terminal's typing does;
  // never for a chat restored with its past.
  const [openedAsleep] = useState(() => !!chat.asleep);
  // The server said this chat sleeps: it knows it, its list may be asked.
  const [knownAsleep, setKnownAsleep] = useState(false);
  useEffect(() => {
    if (state.asleep) setKnownAsleep(true);
  }, [state.asleep]);
  const engaged =
    draft.text.trim() !== "" || (openedAsleep && !!state.sessionId);
  const engagedRef = useRef(engaged);
  const onUserInputRef = useRef(onUserInput);
  useEffect(() => {
    onUserInputRef.current = onUserInput;
  });
  useEffect(() => {
    if (engaged && !engagedRef.current) onUserInputRef.current?.();
    engagedRef.current = engaged;
  }, [engaged]);
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

  // A dictation over (text, failure, cancel), or the pane gone: the
  // question sheet's field it was for no longer takes the next one.
  useEffect(() => {
    if (voiceStatus === "idle") redirectDictation(paneId, null);
  }, [voiceStatus, paneId]);
  useEffect(() => () => redirectDictation(paneId, null), [paneId]);

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
  const sdkActions = useChatSdkActions(pane.id, pane.accountId, onSlashError);

  return (
    <ChatView
      state={state}
      paneId={pane.id}
      accountId={pane.accountId}
      agents={session.agents}
      cwd={chat.cwd}
      isActive={isActive}
      onActivate={onActivate}
      onSend={session.send}
      onInterrupt={session.interrupt}
      onAnswer={session.answer}
      onMode={session.setMode}
      onModel={session.setModel}
      onOpenAgent={session.openAgent}
      onRestart={session.restart}
      hidden={!shown}
      onWake={session.wake}
      onBash={session.bash}
      onStopBash={session.stopBash}
      draft={draft}
      onDraft={setDraft}
      voice={voice}
      messagesOnly={messagesOnly}
      onMessagesOnly={setMessagesOnly}
      onHidden={onHidden}
      onToast={onToast}
      slashActions={slashActions}
      memoryKey={pane.id}
      startup={startupPhase(
        state,
        !!(chat.resume || chat.continue),
        // Asleep till its first session: the welcome stays while it wakes,
        // once the server said it sleeps (its list asked before that would
        // reach a chat it doesn't know yet).
        state.asleep || (!!chat.asleep && knownAsleep),
      )}
      onLoadOlder={session.loadOlder}
      onBackground={session.background}
      onStopTask={session.stopTask}
      onShellOutput={session.taskOutput}
      shellOutputs={shellOutputs}
      sdkActions={sdkActions}
    />
  );
}
