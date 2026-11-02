import { memo, useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { blockShown, type ConvFilters } from "@/lib/convFilters";
import type { ConvBlock } from "@/lib/convStore";
import type { ToolDensity } from "@/types";
import { ConvImages } from "~/messages/conv-images";
import { MarkdownText } from "~/messages/markdown-text";
import { ThinkingBlock } from "~/messages/thinking-block";
import { ToolRow } from "~/messages/tool-row";
import { useConversation } from "~/messages/use-conversation";

/** A block with something to show: a tool call, or text or images. */
function hasContent(block: ConvBlock): boolean {
  if (block.kind === "tool") return true;
  return !!block.text?.trim() || !!block.images?.length;
}

/**
 * The pane's conversation, newest at the bottom, in the Claude app's style
 * (choice A of 25/10/2026): your messages in a bubble, Claude's prose at full
 * width, each tool call a card. The types shown are the desktop reading
 * view's filters (`filters`, its default: your messages and Claude's), its
 * cards open as the desktop's density says. Memoized: the terminal under it
 * redraws 30 times a second.
 */
export const ConversationView = memo(function ConversationView({
  paneId,
  filters,
  density,
}: {
  paneId: string;
  filters: ConvFilters;
  density: ToolDensity;
}) {
  const { blocks, loaded } = useConversation(paneId);
  const present = useMemo(
    () =>
      blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => hasContent(block)),
    [blocks],
  );
  // Inverted list: the newest block is item 0, drawn at the bottom.
  const items = useMemo(
    () =>
      present.filter(({ block }) => blockShown(block.kind, filters)).reverse(),
    [present, filters],
  );

  if (loaded && items.length === 0)
    return (
      <View style={styles.empty}>
        <Text style={styles.note}>
          {present.length > 0
            ? "Tout est masqué par les filtres."
            : "Pas encore de messages."}
        </Text>
      </View>
    );
  return (
    <FlatList
      inverted
      data={items}
      keyExtractor={(item) => String(item.index)}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <BlockItem
          block={item.block}
          density={density}
          showResults={filters.results}
        />
      )}
    />
  );
});

function BlockItem({
  block,
  density,
  showResults,
}: {
  block: ConvBlock;
  density: ToolDensity;
  showResults: boolean;
}) {
  if (block.kind === "tool")
    return (
      <ToolRow block={block} density={density} showResults={showResults} />
    );
  if (block.kind === "thinking")
    return <ThinkingBlock text={block.text ?? ""} />;
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
