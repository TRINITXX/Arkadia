import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { C, T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";
import { tap } from "~/ui/haptics";

/**
 * The chat ended (its Claude Code stopped, or failed): said under the last
 * row with its error, and « Reprendre » starts it again on its session, as
 * the desktop's line in place of the input (`chat-view.tsx`).
 */
export function ClosedLine({
  error,
  onRestart,
}: {
  error?: string;
  onRestart: () => void;
}) {
  return (
    <View style={styles.line}>
      <Text style={styles.text}>
        Conversation arrêtée{error ? ` : ${error}` : ""}
      </Text>
      <Pressable
        onPress={() => {
          tap();
          onRestart();
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <SymbolView name="arrow.counterclockwise" size={12} tintColor={C.ink} />
        <Text style={styles.label}>Reprendre</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { alignItems: "center", gap: 8, paddingTop: 14 },
  text: { color: F.bad, fontSize: T.small, textAlign: "center" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: 999,
    backgroundColor: C.raised,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pressed: { opacity: 0.6 },
  label: { color: C.ink, fontSize: T.small, fontWeight: "500" },
});
