import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PickerRow } from "@/lib/chat/chatSlash";
import { C, T } from "~/chat/chat-theme";

/**
 * A row of /resume or /rewind (`chat-pick` on the desktop): its title, its
 * time (and branch), or what its tap is doing; a row that can't be taken
 * (« en cours », « ouverte ailleurs ») is dim, its reason as a tag.
 */
export function PickerRowView({
  row,
  busy,
  onPress,
}: {
  row: PickerRow;
  /** Its choice under way: « Reprise… », « Retour… ». */
  busy: string | null;
  onPress: () => void;
}) {
  const meta = busy ?? row.meta;
  return (
    <Pressable
      onPress={onPress}
      disabled={!!row.disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressed,
        !!row.disabled && styles.off,
      ]}
    >
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={2}>
          {row.title}
        </Text>
        {meta ? (
          <Text style={[styles.meta, !!busy && styles.busy]}>{meta}</Text>
        ) : null}
      </View>
      {row.disabled ? <Text style={styles.tag}>{row.disabled}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  pressed: { backgroundColor: C.raised },
  off: { opacity: 0.45 },
  main: { flex: 1, gap: 2 },
  title: { color: C.ink, fontSize: T.body },
  meta: { color: C.mute, fontSize: T.tiny },
  busy: { color: C.accent },
  tag: {
    color: C.dim,
    fontSize: T.tiny,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
});
