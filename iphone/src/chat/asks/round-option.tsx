import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { A } from "~/chat/asks/ask-colors";
import { C, T } from "~/chat/chat-theme";

/**
 * An option of Claude's ❓ question (`.chat-sheet-q .opt`): a radio, its
 * letter and words; the one Claude recommends carries « Reco » and his
 * reason. Without a letter, the recommendation is a choice of its own.
 */
export function RoundOption({
  letter,
  label,
  reco,
  reason,
  on,
  onPress,
}: {
  letter?: string;
  label: string;
  reco: boolean;
  reason?: string;
  on: boolean;
  onPress: () => void;
}) {
  const badge = (
    <View style={styles.reco}>
      <SymbolView name="star.fill" size={9} tintColor={C.accentInk} />
      <Text style={styles.recoText}>Reco</Text>
    </View>
  );
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        on && styles.on,
        pressed && !on && styles.pressed,
      ]}
    >
      <View style={[styles.radio, on && styles.radioOn]} />
      <View style={styles.text}>
        {letter ? (
          <Text style={styles.label}>
            <Text style={styles.letter}>{letter}) </Text>
            {label}
          </Text>
        ) : (
          <View style={styles.line}>
            {badge}
            <Text style={[styles.label, styles.grow]}>{label}</Text>
          </View>
        )}
        {letter && reco ? (
          <View style={styles.line}>
            {badge}
            {reason ? <Text style={styles.reason}>{reason}</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.lineStrong,
  },
  pressed: { backgroundColor: "#222529" },
  on: { borderColor: C.accent, backgroundColor: A.optOn },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: A.radio,
  },
  radioOn: { borderWidth: 5, borderColor: C.accent },
  text: { flex: 1, gap: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
  letter: { color: C.mute, fontWeight: "600" },
  label: {
    color: A.strong,
    fontSize: T.body,
    fontWeight: "600",
    lineHeight: 20,
  },
  reason: { flex: 1, color: A.reason, fontSize: T.small, lineHeight: 18 },
  reco: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: C.accent,
  },
  recoText: { color: C.accentInk, fontSize: T.tiny, fontWeight: "700" },
});
