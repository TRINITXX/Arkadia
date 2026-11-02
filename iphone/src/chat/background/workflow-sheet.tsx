import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { workflowAgentSubagent } from "@/lib/chat/chatAgentView";
import { elapsedLabel, modelLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import {
  workflowActivePhase,
  workflowCounts,
  type Workflow,
  type WorkflowAgent,
} from "@/lib/chat/chatTasks";
import { StopButton } from "~/chat/background/stop-button";
import { TaskIcon, workflowAgentTone } from "~/chat/background/task-icon";
import { WORKFLOW_ICON } from "~/chat/background/workflow-card";
import { C, MONO, T } from "~/chat/chat-theme";
import type { AgentSheetRender } from "~/chat/feed/feed-env";
import { FeedSheet } from "~/chat/feed/feed-sheet";
import { useKeptSheet } from "~/chat/feed/use-kept-sheet";
import { tap } from "~/ui/haptics";

const ENDED: Partial<Record<Workflow["status"], string>> = {
  completed: "fini",
  failed: "en échec",
  stopped: "arrêté",
  interrupted: "interrompu",
};

/**
 * A workflow opened from its card, as the desktop's open card: its phases,
 * each with its agents (state, model, tokens, idle time, duration), the
 * phase at work in the accent. A tap on an agent opens its conversation
 * over the sheet, read from its transcript. « Arrêter le workflow » behind
 * a confirmation while it runs. A phone has the height: every phase is
 * listed, none to pick.
 */
export function WorkflowSheet({
  workflow,
  visible,
  agentSheet,
  onStop,
  onClose,
}: {
  /**
   * Kept while the sheet is open and as it slides away, its card gone or
   * not; undefined only for one gone from the chat.
   */
  workflow: Workflow | undefined;
  visible: boolean;
  agentSheet: AgentSheetRender;
  onStop: (taskId: string) => void;
  onClose: () => void;
}) {
  // Kept while its sheet slides away; closed with this one, so it opens
  // again on its phases.
  const picked = useKeptSheet<Subagent>();
  const { close: closePicked } = picked;
  useEffect(() => {
    if (!visible) closePicked();
  }, [visible, closePicked]);
  const running = workflow?.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible || !running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, running]);

  if (!workflow)
    return (
      <FeedSheet visible={visible} title="Workflow" onClose={onClose}>
        {null}
      </FeedSheet>
    );
  const { done, total } = workflowCounts(workflow);
  const active = workflowActivePhase(workflow);
  const phases = workflow.phases.map((p) => ({
    key: String(p.index),
    title: p.title,
    on: p.index === active,
    agents: workflow.agents.filter((a) => a.phaseIndex === p.index),
  }));
  // Agents of no phase it listed: still shown, after the phases.
  const known = new Set(workflow.phases.map((p) => p.index));
  const loose = workflow.agents.filter((a) => !known.has(a.phaseIndex));
  if (loose.length > 0)
    phases.push({
      key: "loose",
      title: "Autres agents",
      on: false,
      agents: loose,
    });
  const figures = [
    ENDED[workflow.status],
    `${done}/${total} agent${total > 1 ? "s" : ""}`,
    elapsedLabel((workflow.endedAt ?? now) - workflow.startedAt),
    workflow.tokens > 0 && `${tokensLabel(workflow.tokens)} tokens`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <FeedSheet
      visible={visible}
      title={workflow.name || "Workflow"}
      icon={WORKFLOW_ICON}
      onClose={onClose}
    >
      <Text style={styles.figures}>{figures}</Text>
      {workflow.description ? (
        <Text style={styles.desc}>{workflow.description}</Text>
      ) : null}
      {phases.length === 0 && (
        <Text style={styles.none}>Pas encore de phase.</Text>
      )}
      {phases.map((p) => {
        const finished = p.agents.filter(
          (a) => a.state !== "running" && a.state !== "queued",
        ).length;
        return (
          <View key={p.key} style={styles.phase}>
            <View style={styles.phaseHead}>
              <Text
                style={[styles.phaseTitle, p.on && styles.phaseOn]}
                numberOfLines={2}
              >
                {p.title || "Phase"}
              </Text>
              <Text style={styles.count}>
                {finished}/{p.agents.length}
              </Text>
            </View>
            {p.agents.length === 0 ? (
              <Text style={styles.none}>Aucun agent dans cette phase.</Text>
            ) : (
              p.agents.map((a) => (
                <AgentLine
                  key={a.agentId}
                  agent={a}
                  now={now}
                  onOpen={() => {
                    tap();
                    picked.open(workflowAgentSubagent(a));
                  }}
                />
              ))
            )}
          </View>
        );
      })}
      {running && (
        <View style={styles.foot}>
          <StopButton
            label="Arrêter le workflow"
            question="Arrêter le workflow et ses agents ?"
            detail={workflow.name || undefined}
            onStop={() => onStop(workflow.taskId)}
          />
        </View>
      )}
      {agentSheet(picked.subject, picked.shown, picked.close)}
    </FeedSheet>
  );
}

function AgentLine({
  agent,
  now,
  onOpen,
}: {
  agent: WorkflowAgent;
  now: number;
  onOpen: () => void;
}) {
  const running = agent.state === "running";
  const duration =
    agent.durationMs ??
    (agent.startedAt !== undefined ? now - agent.startedAt : undefined);
  const idle =
    running && agent.lastActivityAt !== undefined
      ? now - agent.lastActivityAt
      : undefined;
  const meta = [
    agent.model && modelLabel(agent.model),
    agent.tokens !== undefined && `${tokensLabel(agent.tokens)} tokens`,
    // Idle past a few seconds only: an agent at work writes all the time.
    idle !== undefined && idle >= 5_000 && `inactif ${elapsedLabel(idle)}`,
    duration !== undefined && elapsedLabel(duration),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityHint="Ouvre sa conversation"
      style={({ pressed }) => [styles.agent, pressed && styles.pressed]}
    >
      <TaskIcon tone={workflowAgentTone(agent)} />
      <View style={styles.agentText}>
        <Text
          style={[styles.label, agent.state === "queued" && styles.queued]}
          numberOfLines={2}
        >
          {agent.label}
        </Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <SymbolView name="chevron.right" size={11} tintColor={C.mute} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  figures: { color: C.mute, fontSize: T.small, fontVariant: ["tabular-nums"] },
  desc: { color: C.dim, fontSize: T.small },
  none: { color: C.mute, fontSize: T.small - 1, paddingVertical: 4 },
  phase: { gap: 2 },
  phaseHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  phaseTitle: { flex: 1, color: C.dim, fontSize: T.small, fontWeight: "600" },
  phaseOn: { color: C.accent },
  count: {
    color: C.mute,
    fontSize: T.small - 1,
    fontVariant: ["tabular-nums"],
  },
  agent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  pressed: { backgroundColor: C.raised },
  agentText: { flex: 1, gap: 2 },
  label: { color: C.ink, fontFamily: MONO, fontSize: 12.5 },
  queued: { color: C.mute },
  meta: {
    color: C.mute,
    fontSize: T.tiny + 0.5,
    fontVariant: ["tabular-nums"],
  },
  foot: { paddingTop: 4 },
});
