import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { MarkdownText } from "~/messages/markdown-text";

/** The desktop's thinking tint (`MessageBubble`, « Réflexion »). */
const TINT = "#6b7280";

/**
 * Claude's thinking, « Pensées » shown, as the desktop's reading view sets
 * it: under « Réflexion » and its brain, in italics, a little dimmed, along
 * a grey rule.
 */
export function ThinkingBlock({ text }: { text: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <SymbolView name="brain" size={12} tintColor={TINT} />
        <Text style={styles.label}>Réflexion</Text>
      </View>
      <View style={styles.body}>
        <MarkdownText markdown={text} size={14.5} italic />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderLeftWidth: 2,
    borderLeftColor: "rgba(107,114,128,0.75)",
    paddingLeft: 10,
    gap: 4,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { color: "rgba(107,114,128,0.9)", fontSize: 12, fontWeight: "600" },
  body: { opacity: 0.85 },
});
