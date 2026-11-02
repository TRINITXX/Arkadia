import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { elapsedLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import { agentElapsed, pillsThatFit } from "@/lib/chat/chatTasks";
import { subagentTone, TaskIcon } from "~/chat/background/task-icon";
import { C, T } from "~/chat/chat-theme";

/** Between two pills, and the « +N » pill's room, as drawn below. */
const GAP = 6;
const MORE = 44;

/**
 * The running subagents above the input, one pill each (spinner, title,
 * time), as the desktop's (`chat-agent-cards.tsx`, the user's pick A of
 * 02/11/2026). Too many for the width: « +N » lists them all. One that
 * ends shows ✓ (or its alert) for a moment, then leaves (`agentCards`). A
 * tap opens the agent's sheet: its detail, its stop, its conversation.
 */
export function AgentPills({
  agents,
  now,
  onOpen,
  onMore,
}: {
  /** Already filtered: running, or just ended (`agentCards`). */
  agents: Subagent[];
  now: number;
  onOpen: (agent: Subagent) => void;
  onMore: () => void;
}) {
  const [room, setRoom] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  // As many pills as the row holds, measured on a hidden twin of them.
  const measured = agents.map((a) => widths[a.taskId]);
  const fit =
    room > 0 && measured.every((w) => w !== undefined)
      ? pillsThatFit(measured as number[], room, GAP, MORE)
      : agents.length;
  const shown = agents.slice(0, fit);
  const rest = agents.length - shown.length;

  const pill = (agent: Subagent) => (
    <>
      <TaskIcon tone={subagentTone(agent)} />
      <Text style={styles.name} numberOfLines={1}>
        {agent.description || "Sous-agent"}
      </Text>
      <Text style={styles.time}>{elapsedLabel(agentElapsed(agent, now))}</Text>
    </>
  );
  return (
    <View
      style={styles.row}
      onLayout={(e) => setRoom(Math.floor(e.nativeEvent.layout.width))}
    >
      <View style={styles.measure} pointerEvents="none" aria-hidden>
        {agents.map((agent) => (
          <View
            key={agent.taskId}
            style={[styles.pill, styles.twin]}
            onLayout={(e) => {
              const w = Math.ceil(e.nativeEvent.layout.width);
              setWidths((all) =>
                all[agent.taskId] === w ? all : { ...all, [agent.taskId]: w },
              );
            }}
          >
            {pill(agent)}
          </View>
        ))}
      </View>
      {shown.map((agent) => (
        <Pressable
          key={agent.taskId}
          onPress={() => onOpen(agent)}
          accessibilityRole="button"
          accessibilityHint="Ouvre sa fiche et sa conversation"
          hitSlop={4}
          style={({ pressed }) => [
            styles.pill,
            styles.shrink,
            agent.status !== "running" && styles.ended,
            pressed && styles.pressed,
          ]}
        >
          {pill(agent)}
        </Pressable>
      ))}
      {rest > 0 && (
        <Pressable
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel={`${rest} autres sous-agents`}
          hitSlop={4}
          style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        >
          <Text style={styles.more}>+{rest}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: GAP,
    overflow: "hidden",
  },
  /** Out of the layout, wide enough for every pill at its own width. */
  measure: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 4000,
    flexDirection: "row",
    opacity: 0,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    maxWidth: 230,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    backgroundColor: C.raised,
  },
  twin: { flexShrink: 0 },
  /** One pill wider than the row: its title shortens. */
  shrink: { flexShrink: 1, minWidth: 0 },
  ended: { opacity: 0.6 },
  pressed: { backgroundColor: C.lineStrong },
  name: { flexShrink: 1, color: C.ink, fontSize: T.small - 0.5 },
  time: {
    color: C.mute,
    fontSize: T.tiny,
    fontVariant: ["tabular-nums"],
  },
  more: { color: C.dim, fontSize: T.small - 0.5 },
});
