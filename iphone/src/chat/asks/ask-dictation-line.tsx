import { Pressable, StyleSheet, Text } from "react-native";
import { A } from "~/chat/asks/ask-colors";
import type { AskDictation } from "~/chat/asks/use-ask-dictation";
import { T } from "~/chat/chat-theme";
import { DictationBubble } from "~/dictation/dictation-bubble";

/**
 * The words being said for a panel's field, live, with « Annuler » and
 * « Écrire » (the composer's bubble); `label` names the field when another
 * one shows. Else the dictation's error, gone on a tap.
 */
export function AskDictationLine({
  dictation,
  label,
}: {
  dictation: AskDictation;
  label?: string;
}) {
  if (dictation.phase !== "idle")
    return (
      <DictationBubble
        transcript={
          label && dictation.transcript
            ? `${label} : ${dictation.transcript}`
            : dictation.transcript
        }
        level={dictation.level}
        stopping={dictation.phase === "stopping"}
        onCancel={dictation.drop}
        onWrite={() => void dictation.writeOut()}
      />
    );
  if (!dictation.error) return null;
  return (
    <Pressable onPress={dictation.clearError} accessibilityRole="button">
      <Text style={styles.error}>{dictation.error}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  error: { color: A.error, fontSize: T.small, paddingHorizontal: 4 },
});
