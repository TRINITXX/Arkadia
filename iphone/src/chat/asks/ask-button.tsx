import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import { A } from "~/chat/asks/ask-colors";
import { C, T } from "~/chat/chat-theme";

/**
 * The desktop's `.chat-btn` tones: `primary` (the accent), `plain`, `ghost`
 * (no fill), `no` (a refusal Claude Code advises: brown, bold).
 */
export type AskTone = "primary" | "plain" | "ghost" | "no";

/** A panel's button, 44 pt tall at least; its label wraps to two lines. */
export function AskButton({
  label,
  icon,
  tone = "plain",
  disabled = false,
  grow = false,
  hint,
  onPress,
}: {
  label: string;
  icon?: SFSymbol;
  tone?: AskTone;
  disabled?: boolean;
  /** Shares its row with others (`flex: 1`). */
  grow?: boolean;
  /** The desktop's tooltip, for VoiceOver. */
  hint?: string;
  onPress: () => void;
}) {
  const ink = tone === "primary" ? C.accentInk : A.strong;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        TONE[tone],
        grow && styles.grow,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon && <SymbolView name={icon} size={14} tintColor={ink} />}
      <Text
        numberOfLines={2}
        style={[
          styles.label,
          { color: ink },
          (tone === "primary" || tone === "no") && styles.bold,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  grow: { flex: 1 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
  label: { flexShrink: 1, fontSize: T.body, textAlign: "center" },
  bold: { fontWeight: "600" },
});

const TONE = StyleSheet.create({
  primary: { backgroundColor: C.accent, borderColor: C.accent },
  plain: { backgroundColor: A.button, borderColor: C.lineStrong },
  ghost: { backgroundColor: "transparent", borderColor: C.lineStrong },
  no: { backgroundColor: A.picked, borderColor: A.askLine },
});
