import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { ToolItem } from "@/lib/chat/chatGroups";
import { C } from "~/chat/chat-theme";
import { DIM_TONE, F } from "~/chat/feed/feed-style";
import { MarkdownText } from "~/messages/markdown-text";

/** How a plan's approval ended, from ExitPlanMode's result. */
function planOutcome(tool: ToolItem, pending: boolean): string {
  if (pending) return "en attente de ta réponse";
  if (!tool.result) return "";
  return tool.result.isError ||
    /reject|denied|refus|keep planning/i.test(tool.result.text)
    ? "refusé"
    : "approuvé";
}

/**
 * A plan Claude submitted (`chat-plan-card.tsx`). Waiting for the user, it
 * shows in full (the sheet below holds only the choices); decided, it shows
 * its start, the whole of it a tap away.
 */
export function PlanCard({
  tool,
  plan,
  pending,
  onOpen,
}: {
  tool: ToolItem;
  plan: string | null;
  pending: boolean;
  onOpen: () => void;
}) {
  const outcome = planOutcome(tool, pending);
  return (
    <Pressable
      onPress={onOpen}
      disabled={!plan}
      style={({ pressed }) => [
        styles.card,
        pending && styles.pending,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.head}>
        <SymbolView name="list.clipboard" size={14} tintColor={F.head} />
        <Text style={styles.title}>Plan</Text>
        {outcome ? <Text style={styles.outcome}>· {outcome}</Text> : null}
        <View style={styles.tail}>
          <SymbolView name="chevron.right" size={11} tintColor={C.mute} />
        </View>
      </View>
      {plan && (
        <View style={[styles.body, !pending && styles.clamp]}>
          <MarkdownText markdown={plan} tone={DIM_TONE} size={13.5} />
        </View>
      )}
    </Pressable>
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
  pending: { borderColor: "#5a3a2c" },
  pressed: { backgroundColor: C.raised },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: { color: F.head, fontSize: 12.5 },
  outcome: { color: C.mute, fontSize: 12.5 },
  tail: { marginLeft: "auto" },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: F.sep,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  clamp: { maxHeight: 200, overflow: "hidden" },
});
