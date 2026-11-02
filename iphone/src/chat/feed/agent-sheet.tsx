import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import { feedRows } from "@/lib/chat/phoneFeed";
import type { PhoneChatLive } from "@/lib/chat/phoneChatFold";
import { C, T } from "~/chat/chat-theme";
import { FeedList } from "~/chat/feed/feed-list";
import { FeedSheet } from "~/chat/feed/feed-sheet";
import { QuietNote } from "~/chat/feed/quiet-note";
import { useAgentConversation } from "~/chat/feed/use-agent-conversation";
import type { ChatActions } from "~/chat/use-chat";

const STATUS: Record<Subagent["status"], string> = {
  running: "en cours",
  completed: "fini",
  failed: "en échec",
  stopped: "arrêté",
  interrupted: "interrompu",
};

/**
 * A subagent's own conversation over the chat (`chat-agent-sheet.tsx`), with
 * the feed's rows, newest at the bottom. Read only: its marks and stops are
 * the chat's. Also for the screen's running-agent pills to open.
 */
export function AgentSheet({
  agent: opened,
  visible,
  chatId,
  live,
  actions,
  onChoose,
  onClose,
}: {
  agent: Subagent | null;
  visible: boolean;
  chatId: string;
  live: PhoneChatLive;
  actions: ChatActions;
  onChoose: (text: string) => void;
  onClose: () => void;
}) {
  const { agent, conversation } = useAgentConversation(
    live.state,
    live.agents,
    opened,
    actions.openAgent,
    visible,
  );
  const running = agent?.status === "running";
  const rows = useMemo(
    () => (conversation ? feedRows(conversation.items, running) : []),
    [conversation, running],
  );
  const figures = agent
    ? [
        STATUS[agent.status],
        agent.toolUses > 0 && `${agent.toolUses} outils`,
        agent.durationMs > 0 && elapsedLabel(agent.durationMs),
        agent.tokens > 0 && `${tokensLabel(agent.tokens)} tokens`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <FeedSheet
      visible={visible}
      title={agent?.description || "Sous-agent"}
      icon="person.2"
      onClose={onClose}
      scroll={false}
    >
      {figures ? <Text style={styles.figures}>{figures}</Text> : null}
      {!conversation ? (
        <QuietNote text="Chargement de sa conversation…" />
      ) : rows.length === 0 ? (
        <QuietNote text="Conversation vide ou introuvable." />
      ) : (
        <FeedList
          chatId={chatId}
          state={conversation}
          rows={rows}
          actions={actions}
          onChoose={onChoose}
          acts={false}
        />
      )}
    </FeedSheet>
  );
}

const styles = StyleSheet.create({
  figures: {
    color: C.mute,
    fontSize: T.small,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});
