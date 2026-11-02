import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { withoutQuestions } from "@/lib/chat/chatQuestionRound";
import type { ChatItem } from "@/lib/chat/chatState";
import { C, T } from "~/chat/chat-theme";
import { CHAT_TONE, DIM_TONE, F } from "~/chat/feed/feed-style";
import { MessageFrame } from "~/chat/feed/message-frame";
import { MarkdownText } from "~/messages/markdown-text";

type TextItem = Extract<ChatItem, { kind: "text" }>;

/**
 * Claude's reply. The one that answers sits in its violet frame, its opening
 * line a little larger; one that only says what Claude does next (`step`)
 * is a quiet line after a violet dot, so the answer stands out. Written as
 * it comes, the accent's bar at its end.
 */
export function ReplyMessage({
  item,
  step,
  bare,
}: {
  item: TextItem;
  step: boolean;
  /** The question sheet shows its questions: they leave the message
   *  meanwhile, Claude's other words in place (`withoutQuestions`). */
  bare: boolean;
}) {
  const caret = item.streaming ? C.accent : undefined;
  const text = useMemo(
    () => (bare ? withoutQuestions(item.text) : item.text),
    [bare, item.text],
  );
  const note = bare && (
    <View style={styles.bare}>
      <SymbolView name="questionmark.circle" size={12} tintColor={C.mute} />
      <Text style={styles.bareText}>
        Ses questions sont dans la fiche, sous la conversation
      </Text>
    </View>
  );
  if (step)
    return (
      <View style={styles.step}>
        <View style={styles.dot} />
        <View style={styles.stepText}>
          {text ? (
            <MarkdownText
              markdown={text}
              tone={DIM_TONE}
              size={13.5}
              caret={caret}
            />
          ) : null}
          {note}
        </View>
      </View>
    );
  return (
    <MessageFrame
      role="claude"
      text={item.text}
      error={item.error}
      cut={item.aborted}
    >
      {!bare || text ? (
        <MarkdownText
          markdown={text}
          tone={CHAT_TONE}
          size={T.body}
          lead
          caret={caret}
        />
      ) : null}
      {note}
    </MessageFrame>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: "row", gap: 10, paddingHorizontal: 4 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: F.stepDot,
  },
  stepText: { flex: 1, minWidth: 0, gap: 6 },
  bare: { flexDirection: "row", alignItems: "center", gap: 6 },
  bareText: { flex: 1, color: C.mute, fontSize: T.small },
});
