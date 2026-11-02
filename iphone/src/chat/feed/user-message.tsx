import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { fileName } from "@/lib/chat/chatAttachments";
import { userMessageView } from "@/lib/chat/chatImages";
import type { ChatItem } from "@/lib/chat/chatState";
import { C, T } from "~/chat/chat-theme";
import { CHAT_TONE, F, QUEUED_TONE } from "~/chat/feed/feed-style";
import { MessageFrame } from "~/chat/feed/message-frame";
import { QueuedMark } from "~/chat/feed/queued-mark";
import { MarkdownText } from "~/messages/markdown-text";

type UserItem = Extract<ChatItem, { kind: "user" }>;

/**
 * The user's words in their green bubble (`ChatUserBody`): the text, its
 * pasted images as thumbnails (data URLs the chat keeps), the files it
 * attaches as chips, never their paths as text; then, while Claude hasn't
 * taken it, its queued mark.
 */
export function UserMessage({
  item,
  onSendNow,
  onRemove,
}: {
  item: UserItem;
  onSendNow?: () => void;
  onRemove?: () => void;
}) {
  const view = userMessageView(item, null);
  const pasted = item.pasted ?? [];
  // Pasted earlier than the chat keeps: counted, no longer shown.
  const gone = item.images - pasted.length;
  return (
    <MessageFrame role="user" text={item.text}>
      {view.text ? (
        <MarkdownText
          markdown={view.text}
          tone={item.queued ? QUEUED_TONE : CHAT_TONE}
          size={T.body}
        />
      ) : null}
      {pasted.length > 0 && (
        <View style={styles.images}>
          {pasted.map((url, i) => (
            <Image
              key={i}
              source={{ uri: url }}
              style={styles.thumb}
              contentFit="cover"
              accessibilityLabel={`Image collée ${i + 1}`}
            />
          ))}
        </View>
      )}
      {(view.paths.length > 0 || gone > 0) && (
        <View style={styles.files}>
          {view.paths.map((path) => (
            <View key={path} style={styles.chip}>
              <SymbolView name="doc" size={11} tintColor={C.dim} />
              <Text style={styles.chipText} numberOfLines={1}>
                {fileName(path)}
              </Text>
            </View>
          ))}
          {gone > 0 && (
            <View style={styles.chip}>
              <SymbolView name="photo" size={11} tintColor={C.dim} />
              <Text style={styles.chipText}>
                {gone} image{gone > 1 ? "s" : ""}
              </Text>
            </View>
          )}
        </View>
      )}
      {(item.queued || item.dropped) && (
        <QueuedMark
          dropped={item.dropped}
          onSendNow={onSendNow}
          onRemove={onRemove}
        />
      )}
    </MessageFrame>
  );
}

const styles = StyleSheet.create({
  images: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: F.gapBg,
  },
  files: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: 220,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  chipText: { color: C.dim, fontSize: T.tiny, flexShrink: 1 },
});
