import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  OctagonX,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { elapsedLabel, modelLabel, tokensLabel } from "@/lib/chat/chatLabels";
import { useChatLayer } from "@/lib/chat/useChatLayers";
import {
  workflowCounts,
  type Workflow,
  type WorkflowAgent,
} from "@/lib/chat/chatTasks";

/**
 * A running workflow, one line against the input (the user's pick of
 * 30/10/2026): name, progress bar, agents done, time, tokens. A click opens
 * it: its phases on the left, the chosen phase's agents on the right (state,
 * model, tokens, idle time, duration), each agent's conversation a click
 * away, and « Arrêter le workflow » behind a confirmation.
 */
export function ChatWorkflowCard({
  workflow,
  now,
  onOpenAgent,
  onStop,
}: {
  workflow: Workflow;
  now: number;
  onOpenAgent: (agent: WorkflowAgent) => void;
  onStop?: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { done, total } = workflowCounts(workflow);
  const running = workflow.status === "running";
  // Folded, or the workflow over: no « stop it? » left waiting unseen.
  useEffect(() => {
    if (!open || !running) setConfirming(false);
  }, [open, running]);
  // Esc drops the « stop it? » question shown, never Claude's turn.
  useChatLayer(open && running && !!onStop && confirming, () =>
    setConfirming(false),
  );
  const elapsed = (workflow.endedAt ?? now) - workflow.startedAt;
  // The phase at work: its latest running agent's, else the last one.
  const active =
    [...workflow.agents].reverse().find((a) => a.state === "running")
      ?.phaseIndex ??
    workflow.phases[workflow.phases.length - 1]?.index ??
    0;
  const phase = picked ?? active;
  const agents = workflow.agents.filter((a) => a.phaseIndex === phase);

  return (
    <div className={`chat-wf${open ? " open" : ""}${running ? "" : " ended"}`}>
      {open && (
        <div className="body">
          {workflow.description && (
            <div className="desc">{workflow.description}</div>
          )}
          <div className="cols">
            <div className="phases">
              {workflow.phases.length === 0 && (
                <div className="none">Pas encore de phase.</div>
              )}
              {workflow.phases.map((p) => {
                const of = workflow.agents.filter(
                  (a) => a.phaseIndex === p.index,
                );
                const finished = of.filter(
                  (a) => a.state !== "running" && a.state !== "queued",
                ).length;
                return (
                  <div
                    key={p.index}
                    className={`phase${p.index === phase ? " on" : ""}`}
                    onClick={() => setPicked(p.index)}
                  >
                    <span className="t">{p.title}</span>
                    <span className="n">
                      {finished}/{of.length}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="agents">
              {agents.length === 0 && (
                <div className="none">Aucun agent dans cette phase.</div>
              )}
              {agents.map((a) => (
                <WorkflowAgentRow
                  key={a.agentId}
                  agent={a}
                  now={now}
                  onOpen={() => onOpenAgent(a)}
                />
              ))}
            </div>
          </div>
          {running && onStop && (
            <div className="foot">
              {confirming ? (
                <>
                  <span>Arrêter le workflow et ses agents ?</span>
                  <button
                    type="button"
                    className="chat-btn danger"
                    onClick={() => {
                      setConfirming(false);
                      onStop(workflow.taskId);
                    }}
                  >
                    Oui, arrêter
                  </button>
                  <button
                    type="button"
                    className="chat-btn"
                    onClick={() => setConfirming(false)}
                  >
                    Annuler
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="chat-btn"
                  onClick={() => setConfirming(true)}
                >
                  <OctagonX /> Arrêter le workflow
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div
        className="line"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Replier" : "Voir les phases et les agents"}
      >
        {running ? (
          <WorkflowIcon className="ic" />
        ) : workflow.status === "completed" ? (
          <CircleCheck className="ok" />
        ) : (
          <CircleAlert className="ko" />
        )}
        <span className="name">{workflow.name || "Workflow"}</span>
        <span className="bar">
          <span style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
        </span>
        <span className="figs">
          {done}/{total} agent{total > 1 ? "s" : ""} · {elapsedLabel(elapsed)}
          {workflow.tokens > 0 && ` · ${tokensLabel(workflow.tokens)} tokens`}
        </span>
        {open ? (
          <ChevronDown className="chev" />
        ) : (
          <ChevronUp className="chev" />
        )}
      </div>
    </div>
  );
}

function WorkflowAgentRow({
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
  return (
    <div
      className={`agent ${agent.state}`}
      onClick={onOpen}
      title="Ouvrir sa conversation"
    >
      {running ? (
        <span className="spin" />
      ) : agent.state === "done" ? (
        <CircleCheck className="ok" />
      ) : agent.state === "queued" ? (
        <CircleDashed />
      ) : (
        <CircleAlert className="ko" />
      )}
      <span className="label">{agent.label}</span>
      <span className="meta">
        {[
          agent.model && modelLabel(agent.model),
          agent.tokens !== undefined && `${tokensLabel(agent.tokens)} tokens`,
          // Idle past a few seconds only: an agent at work writes all the time.
          idle !== undefined &&
            idle >= 5_000 &&
            `inactif ${elapsedLabel(idle)}`,
          duration !== undefined && elapsedLabel(duration),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}
