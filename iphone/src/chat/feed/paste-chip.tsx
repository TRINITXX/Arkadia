import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { C } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

/**
 * A text pasted as a tag on the PC, in the user's bubble as the desktop's
 * (`chat-paste-chip.tsx`, 02/11/2026): « Texte collé · 42 mots ». A tap
 * opens the text in a sheet, the desktop's hover (`onOpen`, its tap buzz).
 */
export function PasteChip({
  label,
  onOpen,
}: {
  label: string;
  onOpen?: () => void;
}) {
  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Montre le texte collé"
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <SymbolView name="list.clipboard" size={13} tintColor={C.accent} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: F.pasteLine,
    borderRadius: 6,
    backgroundColor: F.pasteBg,
  },
  pressed: { opacity: 0.6 },
  label: { flexShrink: 1, color: F.head, fontSize: 12.5 },
});
