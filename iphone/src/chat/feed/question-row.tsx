import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { questionAnswers, type ToolItem } from "@/lib/chat/chatGroups";
import { C, T } from "~/chat/chat-theme";

/**
 * A question Claude asked (AskUserQuestion), as the column recaps it: its
 * answers once given, else one line (waiting, or never answered).
 */
export function QuestionRow({
  tool,
  pending,
}: {
  tool: ToolItem;
  /** Its request waits in the sheet below. */
  pending: boolean;
}) {
  const answers = questionAnswers(tool);
  if (pending || answers.length === 0)
    return (
      <View style={styles.line}>
        <SymbolView name="questionmark.circle" size={13} tintColor={C.mute} />
        <Text style={styles.lineText}>
          <Text style={styles.bold}>Question</Text>
          {pending ? " · en attente de ta réponse" : " · sans réponse"}
        </Text>
      </View>
    );
  return (
    <View style={styles.qa}>
      {answers.map(([q, a]) => (
        <View key={q}>
          <Text style={styles.q}>{q}</Text>
          <Text style={styles.a}>→ {a}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  lineText: { color: C.mute, fontSize: T.small },
  bold: { color: C.dim, fontWeight: "500" },
  qa: { gap: 6 },
  q: { color: C.dim, fontSize: T.small },
  a: { color: C.ink, fontSize: T.body },
});
