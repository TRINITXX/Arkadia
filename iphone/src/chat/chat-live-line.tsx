import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { retryLabel } from "@/lib/chat/chatErrors";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import { tasksOf, type ChatState } from "@/lib/chat/chatState";
import { liveElapsed, liveStep, timedCall } from "@/lib/chat/chatSteps";
import { taskLine } from "@/lib/chat/chatTaskLine";
import { useDoneAgentsLink } from "@/lib/chat/useDoneAgentsLink";
import { useRunningHook } from "@/lib/chat/useRunningHook";
import { AgentListSheet } from "~/chat/background/agent-list-sheet";
import { C, T } from "~/chat/chat-theme";
import type { AgentSheetRender } from "~/chat/feed/feed-env";
import { TaskListSheet } from "~/chat/task-list-sheet";
import { useChatShown } from "~/chat/use-chat-shown";
import { tap } from "~/ui/haptics";

/** Done tasks dotted at most: the latest, so the one under way stays in sight. */
const MAX_DOTS = 10;

/**
 * The one line that says Claude works, above the composer, as on the desktop
 * (`chat-live-line.tsx`): the step it is on, one time and the turn's tokens;
 * then « Agents terminés (N) » for 30 s after the last one ended
 * (`useDoneAgentsLink`), their list a tap away. The running ones have their
 * pills above the input (`ChatDocked`). With a task list, the step is its
 * task under way: a green dot per task done, « · ensuite : » the next, the
 * whole list a tap away (the desktop's hover); tasks left keep the line
 * while Claude rests (the user's ask of 02/11/2026). Nothing else at rest.
 */
export function ChatLiveLine({
  chatId,
  state,
  cwd,
  agentSheet,
}: {
  chatId: string;
  state: ChatState;
  cwd: string | null;
  /** A finished agent's conversation, over the list that opened it. */
  agentSheet: AgentSheetRender;
}) {
  const [now, setNow] = useState(() => Date.now());
  const { working } = state;
  // Out of sight (the app away, a screen over this one): the clock stops.
  const shown = useChatShown(chatId);
  useEffect(() => {
    if (!working || !shown) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [working, shown]);

  // « Agents terminés (N) » a while after the last one ended, not for good.
  const doneLink = useDoneAgentsLink(state.subagents, state.items);
  const finished = useMemo(
    () => state.subagents.filter((s) => s.status !== "running").reverse(),
    [state.subagents],
  );
  // Its list outlives the link: the 30 s may pass while it is open.
  const [doneOpen, setDoneOpen] = useState(false);
  const doneSheet = (
    <AgentListSheet
      visible={doneOpen}
      title="Agents terminés"
      agents={finished}
      now={now}
      agentSheet={agentSheet}
      onClose={() => setDoneOpen(false)}
    />
  );
  const tasks = useMemo(() => tasksOf(state.items), [state.items]);
  const line = taskLine(tasks);
  // The list follows the tasks while open, even once the line went.
  const [tasksOpen, setTasksOpen] = useState(false);
  const tasksSheet = (
    <TaskListSheet
      visible={tasksOpen}
      tasks={tasks}
      onClose={() => setTasksOpen(false)}
    />
  );
  const openTasks = () => {
    tap();
    setTasksOpen(true);
  };
  // Named once it lasts: a quick one would only flash (`HOOK_SHOW_MS`).
  const hook = useRunningHook(state.sdk.hooks);
  // The lists keep their place whether the line shows or not: they stay open.
  if (!working && !hook && !doneLink && !line.open)
    return (
      <>
        {null}
        {doneSheet}
        {tasksSheet}
      </>
    );

  const request = state.requests[0] ?? state.sdk.elicitations[0];
  const compacting = state.status === "compacting";
  const timed = request ? undefined : timedCall(state.liveTools);
  const elapsed = liveElapsed(
    now,
    state.turnStartedAt,
    compacting || state.retry ? null : (timed?.startedAt ?? null),
  );
  const doing = compacting
    ? "compacte la conversation"
    : state.retry
      ? retryLabel(state.retry, now)
      : hook
        ? `hook ${hook} en cours`
        : request
          ? "attend ta réponse"
          : liveStep(state.liveTools, state.livePhase, cwd);
  const tokens = state.turnTokens + state.thinkingTokens;
  const figures = working
    ? `${elapsed ? ` · ${elapsedLabel(elapsed.ms)}` : ""}${tokens > 0 ? ` · ↓ ${tokensLabel(tokens)} tokens` : ""}`
    : "";
  // Claude works on a task of its list: that task is the line. A retry, a
  // compaction, a hook or a question still say theirs.
  const current =
    working && !compacting && !state.retry && !hook && !request
      ? line.current
      : null;
  const dots = (
    <View style={styles.dots}>
      {line.done.slice(-MAX_DOTS).map((t) => (
        <View key={t.id} style={styles.dot} />
      ))}
      {line.current && <View style={styles.cur} />}
    </View>
  );

  return (
    <>
      <View style={styles.line}>
        {current && (
          <Pressable
            style={styles.now}
            onPress={openTasks}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityHint="Montre toute la liste des tâches"
          >
            <ActivityIndicator size="small" color={C.accent} />
            {dots}
            <Text style={styles.doing} numberOfLines={1}>
              {current.subject}
              {line.next && (
                <Text style={styles.then}>
                  {` · ensuite : ${line.next.subject}`}
                </Text>
              )}
            </Text>
            {figures ? <Text style={styles.figures}>{figures}</Text> : null}
          </Pressable>
        )}
        {/* A hook may run outside a turn: named then too, as on the desktop. */}
        {!current && (working || hook) && (
          <View style={styles.now}>
            <ActivityIndicator size="small" color={C.accent} />
            <Text style={styles.doing} numberOfLines={1}>
              {doing}
              {figures ? <Text style={styles.figures}>{figures}</Text> : null}
            </Text>
          </View>
        )}
        {/* Tasks left with none under way (paused, between two, Claude at
            rest): the dots and what comes next, never a total. */}
        {!current && line.open && (
          <Pressable
            style={styles.now}
            onPress={openTasks}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Liste des tâches"
          >
            {dots}
            {/* The last one left is under way: its words, no « ensuite ». */}
            <Text style={styles.then} numberOfLines={1}>
              {line.next
                ? `ensuite : ${line.next.subject}`
                : line.current?.subject}
            </Text>
          </Pressable>
        )}
        {doneLink && finished.length > 0 && (
          <Pressable
            style={styles.done}
            onPress={() => {
              tap();
              setDoneOpen(true);
            }}
            hitSlop={6}
            accessibilityRole="button"
          >
            <SymbolView name="person.2" size={11} tintColor={C.mute} />
            <Text style={styles.doneText}>
              Agents terminés ({finished.length})
            </Text>
          </Pressable>
        )}
      </View>
      {doneSheet}
      {tasksSheet}
    </>
  );
}

const styles = StyleSheet.create({
  line: { paddingHorizontal: 14, paddingBottom: 6, gap: 5 },
  now: { flexDirection: "row", alignItems: "center", gap: 8 },
  doing: { flex: 1, color: C.ink, fontSize: T.small },
  then: { flexShrink: 1, color: C.mute, fontSize: T.small },
  figures: { color: C.mute, fontSize: T.small, fontVariant: ["tabular-nums"] },
  /** The desktop's task dots (`.chat-task-dots`): done in green, the one under way in accent. */
  dots: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#3f8f5f" },
  cur: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.accent },
  done: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  doneText: {
    color: C.mute,
    fontSize: T.small - 1,
    textDecorationLine: "underline",
    textDecorationColor: C.lineStrong,
  },
});
