import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import { agentElapsed } from "@/lib/chat/chatTasks";
import { subagentTone, TaskIcon } from "~/chat/background/task-icon";
import { C, T } from "~/chat/chat-theme";
import type { AgentSheetRender } from "~/chat/feed/feed-env";
import { FeedSheet } from "~/chat/feed/feed-sheet";
import { QuietNote } from "~/chat/feed/quiet-note";
import { useKeptSheet } from "~/chat/feed/use-kept-sheet";
import { tap } from "~/ui/haptics";

const ENDED: Partial<Record<Subagent["status"], string>> = {
  failed: "en échec",
  stopped: "arrêté",
  interrupted: "interrompu",
};

/**
 * A list of subagents in a sheet, each with its title, a line of its
 * summary, its time and tokens: the desktop's « +N » list and its
 * « Agents terminés (N) » menu (`chat-agents-menu.tsx`). A tap opens the
 * agent's sheet over it (iOS stacks a sheet only from the one under it).
 */
export function AgentListSheet({
  visible,
  title,
  agents,
  now,
  agentSheet,
  onClose,
}: {
  visible: boolean;
  title: string;
  agents: Subagent[];
  /** The running ones' clock. */
  now: number;
  agentSheet: AgentSheetRender;
  onClose: () => void;
}) {
  // Kept while its sheet slides away. Closed with the list: opened again,
  // it lists, never with the last agent's sheet up.
  const picked = useKeptSheet<Subagent>();
  const { close: closePicked } = picked;
  useEffect(() => {
    if (!visible) closePicked();
  }, [visible, closePicked]);
  return (
    <FeedSheet
      visible={visible}
      title={title}
      icon="person.2"
      onClose={onClose}
    >
      {agents.length === 0 ? (
        <QuietNote text="Plus aucun sous-agent ici." />
      ) : (
        agents.map((agent) => {
          const running = agent.status === "running";
          const meta = [
            ENDED[agent.status],
            running
              ? elapsedLabel(agentElapsed(agent, now))
              : agent.durationMs > 0 && elapsedLabel(agent.durationMs),
            agent.tokens > 0 && `${tokensLabel(agent.tokens)} tokens`,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Pressable
              key={agent.taskId}
              onPress={() => {
                tap();
                picked.open(agent);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <TaskIcon tone={subagentTone(agent)} />
              <View style={styles.text}>
                <Text style={styles.title} numberOfLines={2}>
                  {agent.description || "Sous-agent"}
                </Text>
                {agent.summary ? (
                  <Text style={styles.summary} numberOfLines={2}>
                    {agent.summary}
                  </Text>
                ) : null}
                {meta ? <Text style={styles.meta}>{meta}</Text> : null}
              </View>
              <SymbolView name="chevron.right" size={11} tintColor={C.mute} />
            </Pressable>
          );
        })
      )}
      {agentSheet(picked.subject, picked.shown, picked.close)}
    </FeedSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  pressed: { backgroundColor: C.raised },
  text: { flex: 1, gap: 2 },
  title: { color: C.ink, fontSize: T.body, fontWeight: "500" },
  summary: { color: C.dim, fontSize: T.small },
  meta: { color: C.mute, fontSize: T.small - 1, fontVariant: ["tabular-nums"] },
});
