import { useContext, useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { fileName } from "@/lib/chat/chatAttachments";
import { pastedName, userMessageView } from "@/lib/chat/chatImages";
import { framePastes, pasteOfHref, withPasteTags } from "@/lib/chat/chatPastes";
import type { ChatItem } from "@/lib/chat/chatState";
import { itemImagePaths } from "@/lib/chat/phoneImages";
import { C, T } from "~/chat/chat-theme";
import { CHAT_TONE, QUEUED_TONE } from "~/chat/feed/feed-style";
import { ImageThumb } from "~/chat/feed/image-thumb";
import { MessageFrame } from "~/chat/feed/message-frame";
import { PasteChip } from "~/chat/feed/paste-chip";
import { QueuedMark } from "~/chat/feed/queued-mark";
import { LinkCardsContext, type LinkCards } from "~/messages/link-cards";
import { MarkdownText } from "~/messages/markdown-text";

type UserItem = Extract<ChatItem, { kind: "user" }>;

/**
 * The user's words in their green bubble (`ChatUserBody`): the text, the
 * texts it pasted as tags again (`framePastes`, a tap opens one in a sheet),
 * its pasted images (data URLs the chat keeps) and the image files it
 * attaches or names as thumbnails a tap opens full size, its other files as
 * chips, never their paths as text; then, while Claude hasn't taken it, its
 * queued mark. Its foot: the pencil (`onEdit`) and the time it was said.
 */
export function UserMessage({
  item,
  onSendNow,
  onRemove,
  onEdit,
  onOpenPaste,
  editBlocked,
}: {
  item: UserItem;
  onSendNow?: () => void;
  onRemove?: () => void;
  /** Absent on a message Claude hasn't taken (as the desktop). */
  onEdit?: () => void;
  /** A pasted text's tag tapped: its text in a sheet. */
  onOpenPaste?: (paste: string) => void;
  editBlocked: boolean;
}) {
  const view = userMessageView(item, null);
  // The desktop's tags (« Texte collé · N mots », 02/11/2026): the texts the
  // message carries, drawn as cards through the feed's (`LinkCardsContext`).
  const pastes = useMemo(
    () => framePastes(view.text, item.pastes),
    [view.text, item.pastes],
  );
  const shown = useMemo(
    () => withPasteTags(view.text, pastes),
    [view.text, pastes],
  );
  // Read at the tap: a new arrow each render would draw the tags again.
  const openRef = useRef(onOpenPaste);
  useEffect(() => {
    openRef.current = onOpenPaste;
  });
  const outer = useContext(LinkCardsContext);
  const cards = useMemo<LinkCards | null>(() => {
    if (pastes.length === 0) return outer;
    function Card({ href, label }: { href: string; label: string }) {
      const paste = pasteOfHref(href, pastes);
      if (paste === null)
        return outer ? <outer.Card href={href} label={label} /> : null;
      return (
        <PasteChip label={label} onOpen={() => openRef.current?.(paste)} />
      );
    }
    return {
      match: (href) =>
        pasteOfHref(href, pastes) !== null || !!outer?.match(href),
      Card,
    };
  }, [outer, pastes]);
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
        <LinkCardsContext.Provider value={cards}>
          <MarkdownText
            markdown={shown}
            tone={item.queued ? QUEUED_TONE : CHAT_TONE}
            size={T.body}
          />
        </LinkCardsContext.Provider>
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
