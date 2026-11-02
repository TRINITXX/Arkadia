import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { bashCutNote } from "@/lib/chat/chatBash";
import type { ChatItem } from "@/lib/chat/chatState";
import { outputTail } from "@/lib/chat/chatTasks";
import { C, MONO, T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

export type BashItem = Extract<ChatItem, { kind: "bash" }>;

/** The column shows an output's last lines; a tap reads it whole. */
const TAIL_LINES = 12;
const ERROR_LINES = 6;

/** How a `!` command ended, as its card says it; null while it runs or when fine. */
export function bashEnd(item: BashItem): string | null {
  if (item.running) return null;
  if (item.error) return "n'a pas pu démarrer";
  if (item.stopped) return "arrêtée";
  if (item.code !== undefined && item.code !== null && item.code !== 0)
    return `code ${item.code}`;
  return null;
}

/**
 * A `!` command of the user (`chat-bash-card.tsx`): the command, its output
 * as it comes (errors apart, in red), then how it ended. Running, its stop.
 * Claude gets both with the next message; cut for Claude, the card says so.
 */
export function BashCard({
  item,
  onStop,
  onOpen,
}: {
  item: BashItem;
  /** Running and ours to stop: the card's « Arrêter ». */
  onStop?: () => void;
  /** The whole output in a sheet. */
  onOpen: () => void;
}) {
  const stdout = outputTail(item.stdout, TAIL_LINES);
  const stderr = item.error ?? outputTail(item.stderr, ERROR_LINES);
  const cut = bashCutNote(item);
  const end = bashEnd(item);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SymbolView name="terminal" size={13} tintColor={C.mute} />
        <Text style={styles.bang}>!</Text>
        <Text style={styles.command} numberOfLines={3}>
          {item.command}
        </Text>
        {item.running ? (
          <Pressable
            onPress={onStop}
            disabled={!onStop}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Arrêter la commande"
            style={({ pressed }) => [styles.stop, pressed && styles.stopPressed]}
          >
            <ActivityIndicator size="small" color={C.accent} />
            {onStop && <Text style={styles.stopText}>Arrêter</Text>}
          </Pressable>
        ) : end ? (
          <Text style={[styles.end, !(item.stopped && !item.error) && styles.bad]}>
            {end}
          </Text>
        ) : null}
      </View>
      {(stdout || stderr) && (
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          {stdout ? <Text style={styles.out}>{stdout}</Text> : null}
          {stderr ? <Text style={[styles.out, styles.err]}>{stderr}</Text> : null}
        </Pressable>
      )}
      {cut && <Text style={styles.note}>{cut}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: C.card,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bang: { color: C.accent, fontFamily: MONO, fontSize: 12.5, fontWeight: "700" },
  command: { flex: 1, color: F.head, fontFamily: MONO, fontSize: 12.5 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#3a3d43",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  stopPressed: { borderColor: F.badLine },
  stopText: { color: C.mute, fontSize: T.tiny },
  end: { color: C.mute, fontSize: T.tiny },
  bad: { color: F.bad },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: F.sep,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  pressed: { backgroundColor: C.raised },
  out: { color: C.dim, fontFamily: MONO, fontSize: 11.5, lineHeight: 17 },
  err: { color: F.bad },
  note: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: F.sep,
    paddingHorizontal: 12,
    paddingVertical: 5,
    color: F.warn,
    fontSize: T.tiny,
  },
});
