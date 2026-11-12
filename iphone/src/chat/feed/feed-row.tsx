import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { workImagePaths } from "@/lib/chat/chatImages";
import type { ChatState } from "@/lib/chat/chatState";
import type { VisualEntry } from "@/lib/chat/chatVisual";
import {
  bashServerId,
  sameRow,
  sentUuid,
  type FeedRow,
} from "@/lib/chat/phoneFeed";
import { C, T } from "~/chat/chat-theme";
import { ActivityLine } from "~/chat/feed/activity-line";
import { AgentRow } from "~/chat/feed/agent-row";
import { BashCard } from "~/chat/feed/bash-card";
import { ChatVisualCard } from "~/chat/feed/chat-visual-card";
import { CommandCard } from "~/chat/feed/command-card";
import { EditCard } from "~/chat/feed/edit-card";
import type { FeedEnv } from "~/chat/feed/feed-env";
import { CHAT_TONE } from "~/chat/feed/feed-style";
import { MessageFrame } from "~/chat/feed/message-frame";
import { LiveThought } from "~/chat/feed/live-thought";
import { NoticeRow } from "~/chat/feed/notice-row";
import { PeekAlone, PeekIcon } from "~/chat/feed/peek-icon";
import { PlanCard } from "~/chat/feed/plan-card";
import { QuestionRow } from "~/chat/feed/question-row";
import { ReplyMessage } from "~/chat/feed/reply-message";
import { ToolDetailRow } from "~/chat/feed/tool-detail-row";
import { UserMessage } from "~/chat/feed/user-message";
import { MarkdownText } from "~/messages/markdown-text";
import { tap } from "~/ui/haptics";

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
  /** The user's message: its pencil can't act now (dim). */
  editBlocked: boolean;
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
  a.visual === b.visual &&
  a.editBlocked === b.editBlocked;

/**
 * One row of the feed, as the column draws its unit (`chat-timeline.tsx`).
 * Memoised on the row's own items: a reply streaming at the bottom leaves
 * the rows above alone. « Récit » (`placeWork`): Claude's thinking and past
 * tools behind small icons, a tap opening them in a sheet.
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
  editBlocked,
}: FeedRowProps) {
  const { unit } = row;
  const open = (kind: Parameters<FeedEnv["open"]>[0]["kind"]) => () =>
    env.open({ kind, key: row.key, row });
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
        unit.item.queued && sendNow
          ? () => {
              tap();
              void env.actions.interrupt();
            }
          : undefined;
      const onRemove =
        uuid && withdraw
          ? () => {
              tap();
              void env.actions.cancelQueued(uuid);
            }
          : undefined;
      if (unit.kind === "user") {
        const { item } = unit;
        const { edit } = env;
        // Not on a message Claude hasn't taken, as the desktop.
        const onEdit =
          edit && !item.queued && !item.dropped ? () => edit(item) : undefined;
        return (
          <UserMessage
            item={item}
            onSendNow={onSendNow}
            onRemove={onRemove}
            onEdit={onEdit}
            onOpenPaste={(paste) =>
              env.open({ kind: "paste", key: row.key, row, paste })
            }
            editBlocked={editBlocked}
          />
        );
      }
      return (
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
        <MessageFrame
          role="peer"
          label={label}
          text={unit.item.text}
          at={unit.item.at}
        >
          <MarkdownText
            markdown={unit.item.text}
            tone={CHAT_TONE}
            size={T.body}
          />
        </MessageFrame>
      );
    case "text": {
      const { thoughts, tools } = row;
      return (
        <ReplyMessage
          item={unit.item}
          step={row.step}
          past={row.past}
          bare={bare}
          tools={tools}
          cwd={env.cwd}
          peeks={
            thoughts || tools ? (
              <>
                {thoughts && (
                  <PeekIcon kind="thoughts" onPress={open("thoughts")} />
                )}
                {tools && <PeekIcon kind="tools" onPress={open("activity")} />}
              </>
            ) : null
          }
        />
      );
    }
    case "turn":
      return <Text style={styles.done}>{row.turn}</Text>;
    // A row only in a subagent's sheet (`unfolded`): each thought where it
    // came, a tap reading it whole. `foldActivity` gathers it otherwise.
    case "thinking":
      return <LiveThought items={[unit.item]} onOpen={open("thoughts")} />;
    // The latest thought in full while Claude works; one with no reply in
    // its exchange behind a bulb of its own (the others are a reply's).
    case "thoughts":
      return row.alone ? (
        <PeekAlone kind="thoughts" onPress={open("thoughts")} />
      ) : (
        <LiveThought items={unit.items} onOpen={open("thoughts")} />
      );
    case "notice":
      return <NoticeRow item={unit.item} />;
    case "bash": {
      const id = env.acts ? bashServerId(unit.item.id) : null;
      return (
        <BashCard
          item={unit.item}
          onStop={
            id
              ? () => {
                  tap();
                  void env.actions.stopBash(id);
                }
              : undefined
          }
          onOpen={open("bash")}
        />
      );
    }
    // The tool line under way; the others are behind the wrench of the
    // reply that announced them, or a wrench of their own.
    case "activity":
      return row.alone ? (
        <PeekAlone
          kind="tools"
          onPress={open("activity")}
          images={workImagePaths(unit.units, env.cwd)}
        />
      ) : (
        <ActivityLine
          units={unit.units}
          cwd={env.cwd}
          onOpen={open("activity")}
        />
      );
    // Rows only in a subagent's sheet (`unfolded`), as the desktop's draws
    // them: each call on its line, a file change's card, a subagent's line.
    // `foldActivity` gathers them into `activity` otherwise.
    case "work":
      return (
        <View style={styles.tools}>
          {unit.tools.map((tool) => (
            <ToolDetailRow key={tool.id} tool={tool} cwd={env.cwd} />
          ))}
        </View>
      );
    case "edit":
      return <EditCard tool={unit.item} cwd={env.cwd} />;
    // Its own subagent: no conversation to open from here.
    case "agent":
      return <AgentRow tool={unit.item} agent={undefined} />;
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
  // Its calls' icons under its thoughts' bulbs (`LiveThought`).
  tools: { marginLeft: 20 },
});
