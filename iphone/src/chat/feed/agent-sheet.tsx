import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import { feedRows } from "@/lib/chat/phoneFeed";
import {
  phoneChatReadable,
  type PhoneChatLive,
} from "@/lib/chat/phoneChatFold";
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
 * the feed's rows, newest at the bottom, unfolded: each thought and each
 * tool call in order (it writes nothing before its report, so folded, its
 * whole work was one line). Read only: its marks and stops are the chat's.
 * A running agent's pill opens it with its detail on top (what the
 * desktop's pill shows on hover: summary, last action, stop).
 */
export function AgentSheet({
  agent: opened,
  visible,
  chatId,
  live,
  cwd,
  actions,
  onChoose,
  onClose,
  detail,
}: {
  agent: Subagent | null;
  visible: boolean;
  chatId: string;
  live: PhoneChatLive;
  /** The chat's folder: its subagents work in it too. */
  cwd: string | null;
  actions: ChatActions;
  onChoose: (text: string) => void;
  onClose: () => void;
  /** In place of its figures line: the agent as it is now. */
  detail?: (agent: Subagent) => ReactNode;
}) {
  const { agent, conversation } = useAgentConversation(
    live.state,
    live.agents,
    opened,
    actions.openAgent,
    visible,
    phoneChatReadable(live),
  );
  const running = agent?.status === "running";
  const rows = useMemo(
    () =>
      conversation
        ? feedRows(conversation.items, running, { unfolded: true })
        : [],
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
      {agent && detail ? (
        detail(agent)
      ) : figures ? (
        <Text style={styles.figures}>{figures}</Text>
      ) : null}
      {!conversation ? (
        <QuietNote text="Chargement de sa conversation…" />
      ) : rows.length === 0 ? (
        <QuietNote text="Conversation vide ou introuvable." />
      ) : (
        <FeedList
          chatId={chatId}
          state={conversation}
          rows={rows}
          cwd={cwd}
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
