import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ChatState } from "@/lib/chat/chatState";
import type { VisualEntry } from "@/lib/chat/chatVisual";
import { bashServerId, sameRow, sentUuid, type FeedRow } from "@/lib/chat/phoneFeed";
import { C, T } from "~/chat/chat-theme";
import { ActivityLine } from "~/chat/feed/activity-line";
import { BashCard } from "~/chat/feed/bash-card";
import { ChatVisualCard } from "~/chat/feed/chat-visual-card";
import { CommandCard } from "~/chat/feed/command-card";
import type { FeedEnv } from "~/chat/feed/feed-env";
import { CHAT_TONE } from "~/chat/feed/feed-style";
import { MessageFrame } from "~/chat/feed/message-frame";
import { NoticeRow } from "~/chat/feed/notice-row";
import { PlanCard } from "~/chat/feed/plan-card";
import { QuestionRow } from "~/chat/feed/question-row";
import { ReplyMessage } from "~/chat/feed/reply-message";
import { ThoughtsRow } from "~/chat/feed/thoughts-row";
import { UserMessage } from "~/chat/feed/user-message";
import { MarkdownText } from "~/messages/markdown-text";

export interface FeedRowProps {
  row: FeedRow;
  env: FeedEnv;
  /** A queued message: « Envoyer maintenant » can stop the turn for it. */
  sendNow: boolean;
  /** A queued message: × can withdraw it. */
  withdraw: boolean;
  /** A question or plan whose request waits for the user. */
  pending: boolean;
  /** Claude's reply whose questions the round's sheet shows. */
  bare: boolean;
  /** A peer message's head (`peerLabel`). */
  label?: string;
  /** A visual's page and check (`ChatState.visuals`): its row's own part. */
  visual?: VisualEntry;
  /** The chat, for a visual's card; not compared: a visual re-renders for
   *  its own call and entry, never per streamed token. */
  state: ChatState;
}

const same = (a: FeedRowProps, b: FeedRowProps) =>
  sameRow(a.row, b.row) &&
  a.env === b.env &&
  a.sendNow === b.sendNow &&
  a.withdraw === b.withdraw &&
  a.pending === b.pending &&
  a.bare === b.bare &&
  a.label === b.label &&
  a.visual === b.visual;

/**
 * One row of the feed, as the column draws its unit (`chat-timeline.tsx`).
 * Memoised on the row's own items: a reply streaming at the bottom leaves
 * the rows above alone.
 */
export const FeedRowView = memo(function FeedRowView({
  row,
  env,
  sendNow,
  withdraw,
  pending,
  bare,
  label,
  state,
}: FeedRowProps) {
  const { unit } = row;
  const open = (kind: Parameters<FeedEnv["open"]>[0]["kind"]) => () =>
    env.open({ kind, key: row.key });
  switch (unit.kind) {
    case "day":
      return (
        <View style={styles.day} accessibilityRole="header">
          <View style={styles.rule} />
          <Text style={styles.dayText}>{unit.label}</Text>
          <View style={styles.rule} />
        </View>
      );
    case "user":
    case "command": {
      const uuid = unit.item.queued ? sentUuid(unit.item.id) : null;
      const onSendNow =
        unit.item.queued && sendNow ? () => void env.actions.interrupt() : undefined;
      const onRemove =
        uuid && withdraw ? () => void env.actions.cancelQueued(uuid) : undefined;
      return unit.kind === "user" ? (
        <UserMessage item={unit.item} onSendNow={onSendNow} onRemove={onRemove} />
      ) : (
        <CommandCard
          item={unit.item}
          onOpen={open("command")}
          onSendNow={onSendNow}
          onRemove={onRemove}
        />
      );
    }
    case "peer":
      return (
        <MessageFrame role="peer" label={label} text={unit.item.text}>
          <MarkdownText
            markdown={unit.item.text}
            tone={CHAT_TONE}
            size={T.body}
          />
        </MessageFrame>
      );
    case "text":
      return <ReplyMessage item={unit.item} step={row.step} bare={bare} />;
    case "turn":
      return <Text style={styles.done}>{row.turn}</Text>;
    case "thinking":
      return <ThoughtsRow items={[unit.item]} onOpen={open("thoughts")} />;
    case "thoughts":
      return <ThoughtsRow items={unit.items} onOpen={open("thoughts")} />;
    case "notice":
      return <NoticeRow item={unit.item} />;
    case "bash": {
      const id = env.acts ? bashServerId(unit.item.id) : null;
      return (
        <BashCard
          item={unit.item}
          onStop={id ? () => void env.actions.stopBash(id) : undefined}
          onOpen={open("bash")}
        />
      );
    }
    case "activity":
      return <ActivityLine units={unit.units} onOpen={open("activity")} />;
    // Gathered into `activity` by `foldActivity`; kept for the switch.
    case "work":
    case "edit":
    case "agent":
      return <ActivityLine units={[unit]} onOpen={open("activity")} />;
    case "question":
      return <QuestionRow tool={unit.item} pending={pending} />;
    case "visual":
      return (
        <ChatVisualCard
          chatId={env.chatId}
          tool={unit.item}
          state={state}
          actions={env.actions}
          onChoose={env.onChoose}
        />
      );
    case "plan":
      return (
        <PlanCard
          tool={unit.item}
          plan={row.plan}
          pending={pending}
          onOpen={open("plan")}
        />
      );
  }
}, same);

const styles = StyleSheet.create({
  day: { flexDirection: "row", alignItems: "center", gap: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: C.line },
  dayText: { color: C.mute, fontSize: 11.5, letterSpacing: 0.2 },
  done: { color: C.mute, fontSize: 12.5, paddingHorizontal: 2 },
});
