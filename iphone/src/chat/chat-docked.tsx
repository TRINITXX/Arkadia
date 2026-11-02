import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { Subagent } from "@/lib/chat/chatState";
import type { SentStop } from "@/lib/chat/chatTasks";
import type { PhoneChatLive } from "@/lib/chat/phoneChatFold";
import { useLiveActivity } from "@/lib/chat/useLiveActivity";
import { AgentDetail } from "~/chat/background/agent-detail";
import { AgentListSheet } from "~/chat/background/agent-list-sheet";
import { AgentPills } from "~/chat/background/agent-pills";
import { WorkflowCard } from "~/chat/background/workflow-card";
import { WorkflowSheet } from "~/chat/background/workflow-sheet";
import { AgentSheet } from "~/chat/feed/agent-sheet";
import type { AgentSheetRender } from "~/chat/feed/feed-env";
import { useKeptSheet } from "~/chat/feed/use-kept-sheet";
import type { ChatActions } from "~/chat/use-chat";
import { useChatShown } from "~/chat/use-chat-shown";
import { tap } from "~/ui/haptics";

/**
 * What runs beside Claude's turn, docked above the input as on the desktop
 * (`chat-view.tsx`): the subagents' pills, then the workflow card. The
 * screen puts it under the ❓ round's sheet and above a request panel or
 * the input, the desktop's order, so it never sits under what hides the
 * input. Its clock ticks while something shows and the chat is in sight
 * (`useLiveActivity`, `useChatShown`); its sheets live here, so they outlast
 * a pill or a card that leaves.
 */
export function ChatDocked({
  chatId,
  live,
  cwd,
  actions,
  onChoose,
}: {
  chatId: string;
  live: PhoneChatLive;
  cwd: string | null;
  actions: ChatActions;
  onChoose: (text: string) => void;
}) {
  // Out of sight (the app away, a screen over this one): its clock stops.
  const shown = useChatShown(chatId);
  const { now, cards, workflow } = useLiveActivity(live.state, shown);
  // The agent and the workflow shown, kept while their sheet slides away.
  const pill = useKeptSheet<Subagent>();
  const [listOpen, setListOpen] = useState(false);
  const flow = useKeptSheet<string>();
  // A stop sent, by agent: « arrêt demandé… » outlives its sheet closed.
  const [stops, setStops] = useState<Record<string, SentStop>>({});
  const { stopTask } = actions;

  const stopAgent = useCallback(
    (agent: Subagent) => {
      setStops((all) => ({
        ...all,
        [agent.taskId]: { at: Date.now(), run: agent.startedAt },
      }));
      void stopTask(agent.taskId);
    },
    [stopTask],
  );
  // A pill's sheet: its detail and stop on top of its conversation.
  const pillSheet = useCallback<AgentSheetRender>(
    (agent, visible, onClose) => (
      <AgentSheet
        agent={agent}
        visible={visible}
        chatId={chatId}
        live={live}
        cwd={cwd}
        actions={actions}
        onChoose={onChoose}
        onClose={onClose}
        detail={(a) => (
          <AgentDetail
            agent={a}
            cwd={cwd}
            stop={stops[a.taskId]}
            onStop={() => stopAgent(a)}
          />
        )}
      />
    ),
    [chatId, live, cwd, actions, onChoose, stops, stopAgent],
  );
  // A workflow agent's conversation: the desktop offers no stop for one.
  const plainSheet = useCallback<AgentSheetRender>(
    (agent, visible, onClose) => (
      <AgentSheet
        agent={agent}
        visible={visible}
        chatId={chatId}
        live={live}
        cwd={cwd}
        actions={actions}
        onChoose={onChoose}
        onClose={onClose}
      />
    ),
    [chatId, live, cwd, actions, onChoose],
  );

  const shownWorkflow = flow.subject
    ? live.state.workflows.find((w) => w.taskId === flow.subject)
    : undefined;
  const docked = cards.length > 0 || workflow !== undefined;
  return (
    <>
      {docked && (
        <View style={styles.dock}>
          {cards.length > 0 && (
            <AgentPills
              agents={cards}
              now={now}
              onOpen={(agent) => {
                tap();
                pill.open(agent);
              }}
              onMore={() => {
                tap();
                setListOpen(true);
              }}
            />
          )}
          {workflow && (
            <WorkflowCard
              key={workflow.taskId}
              workflow={workflow}
              now={now}
              onOpen={() => {
                tap();
                flow.open(workflow.taskId);
              }}
            />
          )}
        </View>
      )}
      {pillSheet(pill.subject, pill.shown, pill.close)}
      <AgentListSheet
        visible={listOpen}
        title="Sous-agents en cours"
        agents={cards}
        now={now}
        agentSheet={pillSheet}
        onClose={() => setListOpen(false)}
      />
      <WorkflowSheet
        workflow={shownWorkflow}
        visible={flow.shown && shownWorkflow !== undefined}
        agentSheet={plainSheet}
        onStop={(taskId) => void stopTask(taskId)}
        onClose={flow.close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  dock: { paddingHorizontal: 10, paddingBottom: 6, gap: 6 },
});
