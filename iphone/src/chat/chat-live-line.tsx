import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { retryLabel } from "@/lib/chat/chatErrors";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import { tasksOf, type ChatState, type Subagent } from "@/lib/chat/chatState";
import { liveElapsed, liveStep, timedCall } from "@/lib/chat/chatSteps";
import { useRunningHook } from "@/lib/chat/useRunningHook";
import { C, T } from "~/chat/chat-theme";

/**
 * The one line that says Claude works, above the composer, as on the desktop
 * (`chat-live-line.tsx`): the step it is on, its task in progress, one time
 * and the turn's tokens; then the subagents running, as pills a tap opens.
 * Nothing while Claude rests.
 */
export function ChatLiveLine({
  state,
  cwd,
  onOpenAgent,
}: {
  state: ChatState;
  cwd: string | null;
  onOpenAgent: (agent: Subagent) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const { working } = state;
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [working]);

  const agents = state.subagents.filter((a) => a.status === "running");
  // Named once it lasts: a quick one would only flash (`HOOK_SHOW_MS`).
  const hook = useRunningHook(state.sdk.hooks);
  if (!working && !hook && agents.length === 0) return null;

  const request = state.requests[0] ?? state.sdk.elicitations[0];
  const compacting = state.status === "compacting";
  const timed = request ? undefined : timedCall(state.liveTools);
  const elapsed = liveElapsed(
    now,
    state.turnStartedAt,
    compacting || state.retry ? null : (timed?.startedAt ?? null),
  );
  const tasks = tasksOf(state.items);
  const current = tasks.find((t) => t.status === "in_progress");
  const doing = compacting
    ? "compacte la conversation"
    : state.retry
      ? retryLabel(state.retry, now)
      : hook
        ? `hook ${hook} en cours`
        : request
          ? "attend ta réponse"
          : (current?.subject ?? liveStep(state.liveTools, state.livePhase, cwd));
  const tokens = state.turnTokens + state.thinkingTokens;

  return (
    <View style={styles.line}>
      {/* A hook may run outside a turn: named then too, as on the desktop. */}
      {(working || hook) && (
        <View style={styles.now}>
          <ActivityIndicator size="small" color={C.accent} />
          <Text style={styles.doing} numberOfLines={1}>
            {doing}
            {working && (
              <Text style={styles.figures}>
                {elapsed ? ` · ${elapsedLabel(elapsed.ms)}` : ""}
                {tokens > 0 ? ` · ↓ ${tokensLabel(tokens)} tokens` : ""}
              </Text>
            )}
          </Text>
        </View>
      )}
      {agents.length > 0 && (
        <View style={styles.pills}>
          {agents.slice(0, 3).map((a) => (
            <Pressable
              key={a.taskId}
              style={styles.pill}
              onPress={() => onOpenAgent(a)}
              hitSlop={6}
            >
              <View style={styles.dot} />
              <Text style={styles.pillText} numberOfLines={1}>
                {a.type ?? "agent"} · {a.description}
              </Text>
            </Pressable>
          ))}
          {agents.length > 3 && (
            <View style={styles.pill}>
              <Text style={styles.pillText}>+{agents.length - 3}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { paddingHorizontal: 14, paddingBottom: 6, gap: 5 },
  now: { flexDirection: "row", alignItems: "center", gap: 8 },
  doing: { flex: 1, color: C.ink, fontSize: T.small },
  figures: { color: C.mute },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.warn },
  pillText: { color: C.dim, fontSize: T.tiny, flexShrink: 1 },
});
