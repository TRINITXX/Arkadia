import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { CommandItem } from "@/lib/chat/chatCommands";
import { C, MONO, T } from "~/chat/chat-theme";
import { DIM_TONE, F } from "~/chat/feed/feed-style";
import { QueuedMark } from "~/chat/feed/queued-mark";
import { MarkdownText } from "~/messages/markdown-text";

/** An answer past this is cut in the column: a tap reads it whole. */
const LONG_ANSWER = 700;

/**
 * A slash command (`chat-command-card.tsx`): its name and arguments, then
 * what Claude Code answered without the model (/context, /usage…), dimmed
 * so it doesn't read as Claude's words. Sent while Claude works, it waits
 * like a message.
 */
export function CommandCard({
  item,
  onOpen,
  onSendNow,
  onRemove,
}: {
  item: CommandItem;
  /** The whole answer in a sheet. */
  onOpen: () => void;
  onSendNow?: () => void;
  onRemove?: () => void;
}) {
  const long = (item.output?.length ?? 0) > LONG_ANSWER;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SymbolView name="slash.circle" size={13} tintColor={C.mute} />
        <Text
          style={[styles.name, item.queued && styles.queued]}
          numberOfLines={1}
        >
          /{item.name}
        </Text>
        {item.args ? (
          <Text style={styles.args} numberOfLines={2}>
            {item.args}
          </Text>
        ) : null}
      </View>
      {(item.queued || item.dropped) && (
        <View style={styles.mark}>
          <QueuedMark
            dropped={item.dropped}
            onSendNow={onSendNow}
            onRemove={onRemove}
          />
        </View>
      )}
      {item.output ? (
        <Pressable
          disabled={!long}
          onPress={onOpen}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          <View style={long && styles.clamp}>
            <MarkdownText markdown={item.output} tone={DIM_TONE} size={13} />
          </View>
          {long && <Text style={styles.more}>Tout lire</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: C.card,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  name: { color: F.head, fontFamily: MONO, fontSize: 12.5 },
  queued: { color: F.queued },
  args: { flex: 1, color: C.mute, fontFamily: MONO, fontSize: 12.5 },
  mark: { paddingHorizontal: 12, paddingBottom: 8 },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: F.sep,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 6,
  },
  pressed: { backgroundColor: C.raised },
  clamp: { maxHeight: 220, overflow: "hidden" },
  more: { color: C.accent, fontSize: T.small },
});
