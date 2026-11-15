import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { A } from "~/chat/asks/ask-colors";
import { C, T } from "~/chat/chat-theme";

/**
 * An option of Claude's ❓ question (`.chat-sheet-q .opt`): a radio, its
 * letter and words; the one Claude recommends carries « Reco » and his
 * reason. Without a letter, the recommendation is a choice of its own.
 * Claude's AskUserQuestion uses it too: a `description` under the words,
 * and a square box where several can be picked (`multi`).
 */
export function RoundOption({
  letter,
  label,
  reco,
  reason,
  description,
  multi,
  on,
  onPress,
}: {
  letter?: string;
  label: string;
  reco: boolean;
  reason?: string;
  description?: string;
  multi?: boolean;
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
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        // A description under it: the radio by the label's line.
        description ? styles.top : null,
        on && styles.on,
        pressed && !on && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.radio,
          multi && styles.box,
          description ? styles.radioTop : null,
          on && styles.radioOn,
        ]}
      />
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
        {description ? (
          <Text style={styles.description}>{description}</Text>
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
  top: { alignItems: "flex-start" },
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
  box: { borderRadius: 4 },
  radioTop: { marginTop: 1 },
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
  description: { color: C.dim, fontSize: T.small, lineHeight: 18 },
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
