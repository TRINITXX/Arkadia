import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

/**
 * The foot of a message Claude hasn't taken yet (`chat-queued-mark.tsx`): it
 * waits for the turn under way; « Envoyer maintenant » stops that turn so
 * Claude takes it at once; × withdraws it (it leaves the column once Claude
 * Code confirms). `dropped`: it never went.
 */
export function QueuedMark({
  dropped,
  onSendNow,
  onRemove,
}: {
  dropped?: boolean;
  onSendNow?: () => void;
  onRemove?: () => void;
}) {
  if (dropped)
    return (
      <View style={styles.mark}>
        <SymbolView name="nosign" size={11} tintColor={F.bad} />
        <Text style={[styles.text, styles.dropped]}>non envoyé</Text>
      </View>
    );
  return (
    <View style={styles.mark}>
      <SymbolView name="clock" size={11} tintColor={F.queued} />
      <Text style={styles.text}>en attente</Text>
      {onSendNow && (
        <Pressable
          onPress={onSendNow}
          hitSlop={6}
          accessibilityRole="button"
          style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        >
          <SymbolView name="arrow.turn.down.left" size={10} tintColor="#c4c4cc" />
          <Text style={styles.pillText}>Envoyer maintenant</Text>
        </Pressable>
      )}
      {onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retirer ce message"
          style={({ pressed }) => [styles.pill, styles.remove, pressed && styles.pressed]}
        >
          <SymbolView name="xmark" size={10} tintColor="#c4c4cc" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 6,
  },
  text: { color: F.queued, fontSize: T.tiny },
  dropped: { color: F.bad },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: F.pillLine,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  remove: { paddingHorizontal: 6 },
  pressed: { backgroundColor: "#2b2623" },
  pillText: { color: "#c4c4cc", fontSize: T.tiny },
});
