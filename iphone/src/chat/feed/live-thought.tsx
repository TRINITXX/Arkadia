import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { lastThought } from "@/lib/chat/phoneFeed";
import { T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

/** A phone's screen holds this many of its lines; a tap reads it whole. */
const LINES = 6;

/**
 * Claude's latest thinking while it works and no reply follows it yet
 * (`chat-live-thought.tsx`): plain, after a bulb. Once a reply comes, it
 * goes behind that reply's bulb. Past six lines a tap opens it whole.
 * In a subagent's sheet, each of its thoughts where it came.
 */
export function LiveThought({
  items,
  onOpen,
}: {
  items: ThinkingItem[];
  onOpen: () => void;
}) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityHint="Lire toute la réflexion"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <SymbolView
        name="lightbulb"
        size={13}
        tintColor={F.liveBulb}
        style={styles.bulb}
      />
      <Text style={styles.text} numberOfLines={LINES}>
        {lastThought(items)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    marginLeft: 8,
    paddingLeft: 10,
    paddingVertical: 2,
    borderLeftWidth: 2,
    borderLeftColor: F.liveRule,
  },
  pressed: { opacity: 0.6 },
  bulb: { width: 13, height: 13, marginTop: 3 },
  text: { flex: 1, color: F.liveInk, fontSize: T.small, lineHeight: 20 },
});
