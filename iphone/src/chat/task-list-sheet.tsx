import { StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { TaskItem } from "@/lib/chat/chatState";
import { C, T } from "~/chat/chat-theme";
import { FeedSheet } from "~/chat/feed/feed-sheet";
import { QuietNote } from "~/chat/feed/quiet-note";

/**
 * Claude's whole task list, as the desktop shows it on hover of the live
 * line's dots (`chat-live-line.tsx`): done struck through, the one under way
 * in accent, the rest to come. It follows the list live while open.
 */
export function TaskListSheet({
  visible,
  tasks,
  onClose,
}: {
  visible: boolean;
  tasks: TaskItem[];
  onClose: () => void;
}) {
  return (
    <FeedSheet
      visible={visible}
      title="Tâches"
      icon="checklist"
      onClose={onClose}
    >
      {tasks.length === 0 ? (
        <QuietNote text="Plus aucune tâche." />
      ) : (
        tasks.map((t) => {
          const done = t.status === "completed";
          const doing = t.status === "in_progress";
          return (
            <View key={t.id} style={styles.row}>
              <SymbolView
                name={
                  done
                    ? "checkmark.circle"
                    : doing
                      ? "largecircle.fill.circle"
                      : "circle"
                }
                size={15}
                tintColor={done ? C.mute : doing ? C.accent : C.dim}
              />
              <Text
                style={[
                  styles.subject,
                  done && styles.done,
                  doing && styles.doing,
                ]}
              >
                {t.subject}
              </Text>
            </View>
          );
        })
      )}
    </FeedSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  subject: { flex: 1, color: C.ink, fontSize: T.body },
  done: { color: C.mute, textDecorationLine: "line-through" },
  doing: { fontWeight: "600" },
});
