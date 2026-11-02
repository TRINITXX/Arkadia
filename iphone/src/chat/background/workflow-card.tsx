import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import { workflowCounts, type Workflow } from "@/lib/chat/chatTasks";
import { TaskIcon } from "~/chat/background/task-icon";
import { C, T } from "~/chat/chat-theme";

/** The workflow's icon, the desktop's accent one while it runs. */
export const WORKFLOW_ICON = "point.3.connected.trianglepath.dotted";

/**
 * A running workflow, one card against the input, as the desktop's
 * (`chat-workflow-card.tsx`, the user's pick A of 02/11/2026): name,
 * agents done, time, tokens, and its progress bar. A tap opens its sheet
 * (phases, agents, stop). Over, it shows ✓ or its alert for a moment.
 */
export function WorkflowCard({
  workflow,
  now,
  onOpen,
}: {
  workflow: Workflow;
  now: number;
  onOpen: () => void;
}) {
  const { done, total } = workflowCounts(workflow);
  const running = workflow.status === "running";
  const elapsed = (workflow.endedAt ?? now) - workflow.startedAt;
  const figures = [
    `${done}/${total} agent${total > 1 ? "s" : ""}`,
    elapsedLabel(elapsed),
    workflow.tokens > 0 && `${tokensLabel(workflow.tokens)} tokens`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityHint="Voir les phases et les agents"
      style={({ pressed }) => [
        styles.card,
        !running && styles.ended,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.line}>
        {running ? (
          <SymbolView name={WORKFLOW_ICON} size={13} tintColor={C.accent} />
        ) : (
          <TaskIcon tone={workflow.status === "completed" ? "ok" : "ko"} />
        )}
        <Text style={styles.name} numberOfLines={1}>
          {workflow.name || "Workflow"}
        </Text>
        <Text style={styles.figures} numberOfLines={1}>
          {figures}
        </Text>
        <SymbolView name="chevron.up" size={10} tintColor={C.mute} />
      </View>
      <View style={styles.bar}>
        <View
          style={[
            styles.fill,
            { width: `${total > 0 ? (done / total) * 100 : 0}%` },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 7,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    backgroundColor: C.raised,
  },
  ended: { opacity: 0.6 },
  pressed: { backgroundColor: C.lineStrong },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flexShrink: 1, color: C.ink, fontSize: T.small, fontWeight: "500" },
  figures: {
    marginLeft: "auto",
    flexShrink: 0,
    color: C.mute,
    fontSize: T.tiny + 0.5,
    fontVariant: ["tabular-nums"],
  },
  bar: {
    height: 4,
    borderRadius: 999,
    backgroundColor: C.line,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 999, backgroundColor: C.accent },
});
