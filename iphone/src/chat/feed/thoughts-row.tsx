import { Pressable, StyleSheet, Text } from "react-native";
import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { lastThought } from "@/lib/chat/phoneFeed";
import { T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

/** Past this, two lines of a phone cut it: a tap reads it whole. */
const CUT_CHARS = 100;

/** Whether a thought shows whole in its two lines (a phone's width). */
export const thoughtCut = (body: string) =>
  body.length > CUT_CHARS || body.split("\n").length > 2;

/**
 * Claude's thinking between two messages, in indigo and italics so it never
 * reads as the grey line of its work (`chat-thoughts.tsx`): its latest
 * summary alone, two lines at most, the whole of it a tap away when cut.
 */
export function ThoughtsRow({
  items,
  onOpen,
}: {
  items: ThinkingItem[];
  onOpen: () => void;
}) {
  const body = lastThought(items);
  const cut = thoughtCut(body);
  return (
    <Pressable
      disabled={!cut}
      onPress={onOpen}
      accessibilityHint={cut ? "Lire toute la réflexion" : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={styles.text} numberOfLines={2}>
        {body}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 4 },
  pressed: { opacity: 0.6 },
  text: {
    color: F.thought,
    fontStyle: "italic",
    fontSize: T.small,
    lineHeight: 20,
  },
});
