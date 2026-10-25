import { memo, useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import type { ConvBlock } from "@/lib/convStore";
import { ConvImages } from "~/messages/conv-images";
import { MarkdownText } from "~/messages/markdown-text";
import { ToolRow } from "~/messages/tool-row";
import { useConversation } from "~/messages/use-conversation";

/** Thinking stays on the PC: the phone shows what was said and done. */
function shown(block: ConvBlock): boolean {
  if (block.kind === "thinking") return false;
  if (block.kind === "tool") return true;
  return !!block.text?.trim() || !!block.images?.length;
}

/**
 * The pane's conversation, newest at the bottom, in the Claude app's style
 * (choice A of 25/10/2026): your messages in a bubble, Claude's prose at full
 * width, each tool call folded to one line. Memoized: the terminal under it
 * redraws 30 times a second.
 */
export const ConversationView = memo(function ConversationView({
  paneId,
}: {
  paneId: string;
}) {
  const { blocks, loaded } = useConversation(paneId);
  // Inverted list: the newest block is item 0, drawn at the bottom.
  const items = useMemo(
    () =>
      blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => shown(block))
        .reverse(),
    [blocks],
  );

  if (loaded && items.length === 0)
    return (
      <View style={styles.empty}>
        <Text style={styles.note}>Pas encore de messages.</Text>
      </View>
    );
  return (
    <FlatList
      inverted
      data={items}
      keyExtractor={(item) => String(item.index)}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => <BlockItem block={item.block} />}
    />
  );
});

function BlockItem({ block }: { block: ConvBlock }) {
  if (block.kind === "tool") return <ToolRow block={block} />;
  if (block.kind === "user")
    return (
      <View style={styles.user}>
        {block.text ? (
          <Text style={styles.userText} selectable>
            {block.text}
          </Text>
        ) : null}
        <ConvImages images={block.images} />
      </View>
    );
  return <MarkdownText markdown={block.text ?? ""} />;
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  note: { color: "#8e8e93", fontSize: 15 },
  user: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    gap: 6,
    backgroundColor: "#2c2c2e",
    borderRadius: 20,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: { color: "#ffffff", fontSize: 15.5, lineHeight: 21 },
});
