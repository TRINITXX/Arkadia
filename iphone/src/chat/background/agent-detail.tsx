import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import { toolStep } from "@/lib/chat/chatSteps";
import { agentElapsed, stopPending, type SentStop } from "@/lib/chat/chatTasks";
import { StopButton } from "~/chat/background/stop-button";
import { subagentTone, TaskIcon } from "~/chat/background/task-icon";
import { C, T } from "~/chat/chat-theme";

const STATUS: Record<Subagent["status"], string> = {
  running: "en cours",
  completed: "fini",
  failed: "en échec",
  stopped: "arrêté",
  interrupted: "interrompu",
};

/**
 * A running subagent's detail on top of its sheet, the desktop pill's
 * hover card (`AgentDetail` of `chat-agent-cards.tsx`): what it does (its
 * summary, else its last action), a retry, its time and tokens, and its
 * stop behind a confirmation (`stopTask`). « arrêt demandé… » while the
 * stop is on its way (`stopPending`).
 */
export function AgentDetail({
  agent,
  cwd,
  stop,
  onStop,
}: {
  agent: Subagent;
  cwd: string | null;
  stop?: SentStop;
  /** Absent: no stop button. */
  onStop?: () => void;
}) {
  const running = agent.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const stopping = stopPending(stop, agent, now);
  // Its AI summary comes every ~30 s; before it, the line is its last action.
  const summary = agent.summary?.split("\n")[0];
  const action = agent.lastAction
    ? toolStep(agent.lastAction.name, agent.lastAction.input, cwd)
    : null;
  const figures = [
    !running && STATUS[agent.status],
    elapsedLabel(agentElapsed(agent, now)),
    agent.tokens > 0 && `${tokensLabel(agent.tokens)} tokens`,
    agent.toolUses > 0 && `${agent.toolUses} outils`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.detail}>
      <View style={styles.now}>
        <TaskIcon tone={subagentTone(agent)} />
        {stopping ? (
          <Text style={styles.says}>arrêt demandé…</Text>
        ) : agent.retry ? (
          <Text style={[styles.says, styles.retry]}>
            réessaie ({agent.retry.attempt}/{agent.retry.max})
            {agent.retry.status ? ` · erreur ${agent.retry.status}` : ""}
          </Text>
        ) : (
          <Text style={styles.says} numberOfLines={3}>
            {summary || action || (running ? "démarre…" : STATUS[agent.status])}
          </Text>
        )}
      </View>
      {summary && action ? (
        <Text style={styles.action} numberOfLines={2}>
          ↳ {action}
        </Text>
      ) : null}
      <Text style={styles.figures}>{figures}</Text>
      {running && onStop && !stopping && (
        <StopButton
          label="Arrêter"
          question="Arrêter ce sous-agent ?"
          detail={agent.description || undefined}
          onStop={onStop}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  detail: {
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  now: { flexDirection: "row", alignItems: "center", gap: 8 },
  says: { flex: 1, color: C.ink, fontSize: T.small },
  retry: { color: C.warn },
  action: { color: C.dim, fontSize: T.small, paddingLeft: 21 },
  figures: {
    color: C.mute,
    fontSize: T.small - 1,
    fontVariant: ["tabular-nums"],
    paddingLeft: 21,
  },
});
