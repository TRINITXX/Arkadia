import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { fileName } from "@/lib/chat/chatAttachments";
import { pastedName, userMessageView } from "@/lib/chat/chatImages";
import type { ChatItem } from "@/lib/chat/chatState";
import { itemImagePaths } from "@/lib/chat/phoneImages";
import { C, T } from "~/chat/chat-theme";
import { CHAT_TONE, QUEUED_TONE } from "~/chat/feed/feed-style";
import { ImageThumb } from "~/chat/feed/image-thumb";
import { MessageFrame } from "~/chat/feed/message-frame";
import { QueuedMark } from "~/chat/feed/queued-mark";
import { MarkdownText } from "~/messages/markdown-text";

type UserItem = Extract<ChatItem, { kind: "user" }>;

/**
 * The user's words in their green bubble (`ChatUserBody`): the text, its
 * pasted images (data URLs the chat keeps) and the image files it attaches
 * or names as thumbnails a tap opens full size, its other files as chips,
 * never their paths as text; then, while Claude hasn't taken it, its
 * queued mark. Its foot: the pencil (`onEdit`) and the time it was said.
 */
export function UserMessage({
  item,
  onSendNow,
  onRemove,
  onEdit,
  editBlocked,
}: {
  item: UserItem;
  onSendNow?: () => void;
  onRemove?: () => void;
  /** Absent on a message Claude hasn't taken (as the desktop). */
  onEdit?: () => void;
  editBlocked: boolean;
}) {
  const view = userMessageView(item, null);
  const pasted = item.pasted ?? [];
  const images = itemImagePaths(item);
  const files = view.paths.filter((path) => !images.includes(path));
  // Pasted earlier than the chat keeps: counted, no longer shown.
  const gone = item.images - pasted.length;
  return (
    <MessageFrame
      role="user"
      text={item.text}
      at={item.at}
      onEdit={onEdit}
      editBlocked={editBlocked}
    >
      {view.text ? (
        <MarkdownText
          markdown={view.text}
          tone={item.queued ? QUEUED_TONE : CHAT_TONE}
          size={T.body}
        />
      ) : null}
      {pasted.length + images.length > 0 && (
        <View style={styles.images}>
          {pasted.map((url, i) => (
            <ImageThumb key={i} path={pastedName(gone + i + 1)} url={url} />
          ))}
          {images.map((path) => (
            // An attached file keeps its name if it can't be shown.
            <ImageThumb
              key={path}
              path={path}
              named={view.paths.includes(path)}
            />
          ))}
        </View>
      )}
      {(files.length > 0 || gone > 0) && (
        <View style={styles.files}>
          {files.map((path) => (
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
