import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import {
  activityCounts,
  activityTools,
  type ActivityKind,
  type FoldedUnit,
} from "@/lib/chat/chatGroups";
import { workTail } from "@/lib/chat/chatSteps";
import { C, T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";

/** The desktop's Lucide icons per kind of work, as SF Symbols. */
export const ACTIVITY_ICONS: Record<ActivityKind, SFSymbol> = {
  command: "terminal",
  read: "doc.text",
  search: "magnifyingglass",
  web: "globe",
  skill: "sparkles",
  tool: "wrench.and.screwdriver",
  edit: "square.and.pencil",
  agent: "person.2",
};

/**
 * Claude's work between two messages on one quiet line
 * (`chat-activity-line.tsx`): an icon and a number per kind, how many calls
 * failed, then its last call in words once done. While it runs, the counts
 * alone: the live line above the input says the step. A tap opens it whole
 * in a sheet (tool lines, file changes, subagents).
 */
export function ActivityLine({
  units,
  onOpen,
}: {
  units: FoldedUnit[];
  onOpen: () => void;
}) {
  const counts = useMemo(() => activityCounts(units), [units]);
  const { last, failed } = useMemo(
    () => workTail(activityTools(units), null),
    [units],
  );
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={counts.map((c) => c.label).join(", ")}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
    >
      <SymbolView name="chevron.right" size={10} tintColor={C.mute} />
      <View style={styles.counts}>
        {counts.map(({ kind, n }) => (
          <View key={kind} style={styles.count}>
            <SymbolView name={ACTIVITY_ICONS[kind]} size={12} tintColor={C.dim} />
            <Text style={styles.n}>{n}</Text>
          </View>
        ))}
      </View>
      {/* Grey as the rest: an error Claude got past is no alarm. */}
      {failed > 0 && <Text style={styles.tail}>· {failed} en erreur</Text>}
      {last ? (
        <Text style={[styles.tail, styles.step]} numberOfLines={1}>
          · {last}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: 8,
    paddingVertical: 3,
    paddingLeft: 2,
    paddingRight: 6,
  },
  pressed: { backgroundColor: C.raised },
  counts: { flexDirection: "row", alignItems: "center", gap: 10 },
  count: { flexDirection: "row", alignItems: "center", gap: 3 },
  n: { color: C.dim, fontSize: T.small, fontVariant: ["tabular-nums"] },
  tail: { color: C.mute, fontSize: T.small },
  step: { flexShrink: 1, color: F.stepInk },
});
