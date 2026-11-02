import { Pressable, StyleSheet, Text, View } from "react-native";
import { A } from "~/chat/asks/ask-colors";
import { C, T } from "~/chat/chat-theme";

/** An AskUserQuestion option (`.chat-opt`): its number, its words, picked or not. */
export function QuestionOption({
  n,
  label,
  description,
  picked,
  multi,
  onPress,
}: {
  n: number;
  label: string;
  description?: string;
  picked: boolean;
  multi: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={{ checked: picked }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        picked && styles.picked,
        pressed && !picked && styles.pressed,
      ]}
    >
      <View style={[styles.key, picked && styles.keyOn]}>
        <Text style={[styles.keyText, picked && styles.keyTextOn]}>{n}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
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
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "transparent",
  },
  pressed: { backgroundColor: "#25282c" },
  picked: { backgroundColor: A.picked, borderColor: A.askLine },
  key: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: A.optionKey,
  },
  keyOn: { backgroundColor: C.accent },
  keyText: { color: C.dim, fontSize: T.small - 1 },
  keyTextOn: { color: C.accentInk, fontWeight: "700" },
  text: { flex: 1, gap: 2, paddingTop: 3 },
  label: { color: A.option, fontSize: T.body, lineHeight: 20 },
  description: { color: C.mute, fontSize: T.small, lineHeight: 18 },
});
