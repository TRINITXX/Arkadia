import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { C, T } from "~/chat/chat-theme";
import { tap, tick } from "~/ui/haptics";

/**
 * « Arrêter » of a subagent or a workflow, behind a confirmation as on the
 * desktop (its « Oui, arrêter »): here iOS's own alert, its stop in red.
 */
export function StopButton({
  label,
  question,
  detail,
  onStop,
}: {
  label: string;
  question: string;
  /** Under the question: what stops. */
  detail?: string;
  onStop: () => void;
}) {
  const ask = () => {
    tick();
    Alert.alert(question, detail, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Arrêter",
        style: "destructive",
        onPress: () => {
          tap();
          onStop();
        },
      },
    ]);
  };
  return (
    <Pressable
      onPress={ask}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <SymbolView name="xmark.octagon" size={14} tintColor={C.ink} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.raised,
  },
  pressed: { opacity: 0.6 },
  label: { color: C.ink, fontSize: T.body, fontWeight: "500" },
});
