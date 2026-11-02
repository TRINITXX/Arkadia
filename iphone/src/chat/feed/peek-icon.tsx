import { Pressable, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { F } from "~/chat/feed/feed-style";

/** What an icon hides: Claude's thinking (a bulb) or its tools (a wrench). */
export type PeekKind = "thoughts" | "tools";

const LABEL: Record<PeekKind, string> = {
  thoughts: "Sa réflexion",
  tools: "Ses outils",
};

/**
 * « Récit » (`chat-thought-bulb.tsx`, `chat-work-icon.tsx`): Claude's
 * thinking behind a bulb, its past tools behind a wrench, on the reply they
 * belong to. No hover on a phone: a tap opens what it hides in a sheet.
 */
export function PeekIcon({
  kind,
  onPress,
}: {
  kind: PeekKind;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={LABEL[kind]}
      style={({ pressed }) => [styles.peek, pressed && styles.on]}
    >
      {({ pressed }) => (
        <SymbolView
          name={kind === "thoughts" ? "lightbulb" : "wrench.adjustable"}
          size={13}
          tintColor={pressed ? F.peekOn : F.footInk}
        />
      )}
    </Pressable>
  );
}

/** Thinking or tools with no reply in their exchange: an icon of their own. */
export function PeekAlone({
  kind,
  onPress,
}: {
  kind: PeekKind;
  onPress: () => void;
}) {
  return (
    <View style={styles.alone}>
      <PeekIcon kind={kind} onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  peek: {
    width: 26,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  on: { backgroundColor: "#25282c" },
  alone: { flexDirection: "row", paddingHorizontal: 2 },
});
