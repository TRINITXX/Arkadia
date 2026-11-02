import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import { A } from "~/chat/asks/ask-colors";
import { C, T } from "~/chat/chat-theme";

/** A panel's title line (`.chat-ask-head`): its icon in the accent, a note on the right. */
export function AskHead({
  icon,
  title,
  note,
}: {
  icon: SFSymbol;
  title: string;
  note?: string;
}) {
  return (
    <View style={styles.head}>
      <SymbolView name={icon} size={16} tintColor={C.accent} />
      <Text style={styles.title}>{title}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 2,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    color: A.strong,
    fontSize: T.body,
    fontWeight: "600",
    lineHeight: 20,
  },
  note: { color: C.mute, fontSize: T.small - 1 },
});
