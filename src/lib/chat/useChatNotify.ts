import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaneBackground } from "@/lib/agentState";
import {
  chatActivity,
  chatReplaying,
  subscribeChatActivity,
  subscribeEveryChat,
} from "@/lib/chat/chatEvents";
import { folderOf } from "@/lib/chat/chatLabels";
import {
  chatRing,
  EMPTY_TRACK,
  isLiveEvent,
  stepChatNotify,
  type ChatNotifyTrack,
  type ChatSignal,
} from "@/lib/chat/chatNotify";
import { chatLabelOf } from "@/lib/chat/usePaneChats";
import type { Tab } from "@/types";

/**
 * Every chat's notifications and badge rings, for the page's life: from the
 * stream of all chats (`subscribeEveryChat`), so a chat whose pane is not
 * mounted (another project's tab) notifies all the same. `onRing` hears a
 * chat's rings when they change, never mid-replay.
 */
export function watchChatNotify(
  onSignal: (chatId: string, signal: ChatSignal) => void,
  onRing: (chatId: string, ring: PaneBackground) => void,
): () => void {
  const tracks = new Map<string, ChatNotifyTrack>();
  const rings = new Map<string, PaneBackground>();
  const ring = (chatId: string) => {
    if (chatReplaying(chatId)) return;
    const next = chatRing(
      tracks.get(chatId) ?? EMPTY_TRACK,
      chatActivity(chatId),
    );
    const last = rings.get(chatId);
    if (last?.shells === next.shells && last.question === next.question) return;
    rings.set(chatId, next);
    onRing(chatId, next);
  };
  const offEvents = subscribeEveryChat((event) => {
    if (!("chatId" in event) || !event.chatId) return;
    const chatId = event.chatId;
    const now = Date.now();
    const live = isLiveEvent(event, chatReplaying(chatId), now);
    const { track, signal } = stepChatNotify(
      tracks.get(chatId) ?? EMPTY_TRACK,
      event,
      chatActivity(chatId),
      live,
      now,
    );
    tracks.set(chatId, track);
    if (signal) onSignal(chatId, signal);
    ring(chatId);
  });
  // A server gone: its chats hear a `closed` (`chatEvents`), their rings
  // follow their activity at rest.
  const offActivity = subscribeChatActivity(ring);
  return () => {
    offEvents();
    offActivity();
  };
}

/**
 * Chat panes notify through the same popup path as terminal panes
 * (`popup_chat_signal`), always as the compact toast « Projet · Onglet »,
 * the tab named by the chat's title. Returns each chat pane's rings for its
 * badge, in place of the hook's pane map.
 */
export function useChatNotify(tabs: Tab[]): Record<string, PaneBackground> {
  const [rings, setRings] = useState<Record<string, PaneBackground>>({});
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    const send = (chatId: string, signal: ChatSignal) => {
      const pane = tabsRef.current
        .flatMap((t) => Object.values(t.panes))
        .find((p) => p.id === chatId);
      // Closed, or back to its terminal: nothing to name nor open.
      if (!pane?.chat) return;
      void invoke("popup_chat_signal", {
        paneId: chatId,
        kind: signal.kind,
        selfWoken: signal.selfWoken,
        round: signal.round,
        tabTitle: chatLabelOf(pane.title) || folderOf(pane.chat.cwd),
        cwd: pane.chat.cwd,
      }).catch(() => {});
    };
    return watchChatNotify(send, (chatId, ring) =>
      setRings((prev) => ({ ...prev, [chatId]: ring })),
    );
  }, []);

  return rings;
}
