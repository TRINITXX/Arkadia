import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { ChatItem, Subagent } from "@/lib/chat/chatState";
import type { PhoneChatLive } from "@/lib/chat/phoneChatFold";
import { startupPhase } from "@/lib/chat/chatStartup";
import { feedRows } from "@/lib/chat/phoneFeed";
import { useRoundShown } from "~/chat/asks/round-store";
import { ChatWelcome } from "~/chat/chat-welcome";
import { AgentSheet } from "~/chat/feed/agent-sheet";
import { ClosedLine } from "~/chat/feed/closed-line";
import type { AgentSheetRender } from "~/chat/feed/feed-env";
import { FeedList } from "~/chat/feed/feed-list";
import { OlderButton } from "~/chat/feed/older-button";
import { QuietNote } from "~/chat/feed/quiet-note";
import type { ChatActions } from "~/chat/use-chat";

export interface ChatFeedProps {
  chatId: string;
  /** The chat's state, and the subagent conversations asked for. */
  live: PhoneChatLive;
  /** The chat's folder: tool lines name files from it; null: from home. */
  cwd: string | null;
  actions: ChatActions;
  /** A visual's button chose a text: it goes into the composer (not sent). */
  onChoose: (text: string) => void;
  /** « Messages seuls » (the ⋯ menu): the user's and Claude's words only. */
  messagesOnly: boolean;
  /** The pencil on the user's messages; absent: no pencil. */
  onEdit?: (item: Extract<ChatItem, { kind: "user" }>) => void;
  /** The pencil can't act now (Claude at work, a request open): dim. */
  editBlocked: boolean;
}

/**
 * The conversation, newest at the bottom (an inverted list): what the
 * desktop column shows (`chat-timeline.tsx`), adapted to the phone. Each
 * row re-renders for its own items only (`sameRow`); what a row folds opens
 * whole in a sheet (`FeedList`).
 */
export function ChatFeed({
  chatId,
  live,
  cwd,
  actions,
  onChoose,
  messagesOnly,
  onEdit,
  editBlocked,
}: ChatFeedProps) {
  const { state } = live;
  // « Messages seuls » keeps the plan a request waits on.
  const pending = useMemo(
    () => new Set(state.requests.map((r) => r.toolUseId)),
    [state.requests],
  );
  const rows = useMemo(
    () => feedRows(state.items, state.working, { messagesOnly, pending }),
    [state.items, state.working, messagesOnly, pending],
  );
  // The ❓ round's sheet unfolded: its questions leave those replies.
  const bareIds = useRoundShown(chatId, state);
  // Seen asleep: a new chat keeps its welcome while it wakes (a letter
  // typed, Claude Code booting), as the desktop's (`chat-pane.tsx`).
  const [seenAsleep, setSeenAsleep] = useState(state.asleep);
  if (state.asleep && !seenAsleep) setSeenAsleep(true);
  // A subagent's conversation over the activity sheet that opened it.
  const agentSheet = useCallback<AgentSheetRender>(
    (agent: Subagent | null, visible: boolean, onClose: () => void) => (
      <AgentSheet
        agent={agent}
        visible={visible}
        chatId={chatId}
        live={live}
        cwd={cwd}
        actions={actions}
        onChoose={onChoose}
        onClose={onClose}
      />
    ),
    [chatId, live, cwd, actions, onChoose],
  );
  const { closed, historyTruncated, historyCursor } = state;
  const { loadOlder, restart } = actions;
  const top = useMemo(
    () =>
      historyTruncated ? (
        <OlderButton cursor={historyCursor} onLoad={loadOlder} />
      ) : null,
    [historyTruncated, historyCursor, loadOlder],
  );
  const bottom = useMemo(
    () =>
      closed ? (
        <ClosedLine error={closed.error} onRestart={() => void restart()} />
      ) : null,
    [closed, restart],
  );

  if (rows.length === 0) {
    // A new chat asleep, waking, or booted with nothing said: the folder's
    // sessions to resume (`startupPhase` « welcome », as the desktop's,
    // 02/11/2026). Read from the chat's state, not only from this screen's
    // memory: a screen left and opened again has none.
    if (
      live.replay === null &&
      !closed &&
      state.items.length === 0 &&
      (state.asleep || seenAsleep || startupPhase(state, false) === "welcome")
    )
      return (
        <View style={styles.feed}>
          <ChatWelcome actions={actions} sessionId={state.sessionId} />
        </View>
      );
    // Before its first replay, or a chat that never said anything yet.
    const loading =
      live.replay !== null ||
      (!state.historyLoaded &&
        !closed &&
        !state.asleep &&
        state.commands.length === 0 &&
        state.context === null);
    return (
      <View style={styles.feed}>
        <QuietNote
          text={
            loading
              ? "Chargement de la conversation…"
              : "Pas encore de messages."
          }
        />
        {bottom}
      </View>
    );
  }
  return (
    <View style={styles.feed}>
      <FeedList
        chatId={chatId}
        state={state}
        rows={rows}
        cwd={cwd}
        actions={actions}
        onChoose={onChoose}
        acts
        top={top}
        bottom={bottom}
        agentSheet={agentSheet}
        bareIds={bareIds}
        onEdit={onEdit}
        editBlocked={editBlocked}
      />
    </View>
  );
}

const styles = StyleSheet.create({ feed: { flex: 1 } });
