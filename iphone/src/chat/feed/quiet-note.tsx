import { StyleSheet, Text, View } from "react-native";
import { C, T } from "~/chat/chat-theme";

/** A quiet line in place of a conversation: loading, or nothing to show. */
export function QuietNote({ text }: { text: string }) {
  return (
    <View style={styles.quiet}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  quiet: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  text: { color: C.mute, fontSize: T.small, textAlign: "center" },
});
