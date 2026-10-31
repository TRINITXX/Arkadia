import { useEffect, useState } from "react";
import { Bot, Circle, CircleCheck, CircleDot, ListChecks } from "lucide-react";
import { retryLabel, type RetryInfo } from "@/lib/chat/chatErrors";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent, TaskItem } from "@/lib/chat/chatState";
import { liveElapsed } from "@/lib/chat/chatSteps";
import { useChatLayer } from "@/lib/chat/useChatLayers";

/**
 * What the terminal shows above its input while Claude works, the one line
 * that says it: the spinner, the step it is on (« lit chatState.ts »,
 * `liveStep`), one time (the running call's, else the turn's: `liveElapsed`)
 * and the turn's tokens (thinking's estimate included); the subagents just
 * finished and the task list, one click away (running ones have their cards).
 */
export function ChatLiveLine({
  working,
  compacting,
  step,
  turnStartedAt,
  turnTokens,
  subagents,
  tasks,
  onOpenAgents,
  retry = null,
  stepSince = null,
  backgroundHint = false,
  hook = null,
}: {
  working: boolean;
  compacting: boolean;
  step: string;
  /** A hook running a while (`useRunningHook`): « hook Stop en cours », turn or not. */
  hook?: string | null;
  /** When the running call began: its time replaces the turn's past a few seconds. */
  stepSince?: number | null;
  /** That call is a foreground Bash or agent: Ctrl+B is said, as in the terminal. */
  backgroundHint?: boolean;
  /** « Claude réessaie (2/10) dans 5 s · surcharge » in place of the step. */
  retry?: RetryInfo | null;
  turnStartedAt: number | null;
  turnTokens: number;
  /** « Agents terminés (N) », empty once it's due to go (`useDoneAgentsLink`). */
  subagents: Subagent[];
  tasks: TaskItem[];
  onOpenAgents: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [tasksOpen, setTasksOpen] = useState(false);
  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [working]);

  const done = tasks.filter((t) => t.status === "completed").length;
  const openTasks = tasks.length > 0 && done < tasks.length;
  const quiet = !working && !hook && subagents.length === 0 && !openTasks;
  // Esc closes the tasks shown, never Claude's turn (`chatLayers`).
  useChatLayer(tasksOpen && tasks.length > 0 && !quiet, () =>
    setTasksOpen(false),
  );
  // Nothing to say: no line at all, no empty band above the input (the
  // user's ask of 31/10/2026).
  if (quiet) return null;
  // A call running a while: its time, and Ctrl+B for a command or an agent.
  const elapsed = liveElapsed(
    now,
    turnStartedAt,
    compacting || retry ? null : stepSince,
  );

  // A failed request Claude Code sends again: said, not a silent spinner.
  const doing = compacting
    ? "compacte la conversation"
    : retry
      ? retryLabel(retry, now)
      : hook
        ? `hook ${hook} en cours`
        : step;
  return (
    <div className="chat-live">
      {(working || hook) && (
        <span className={`chat-live-now${retry ? " retry" : ""}`}>
          <span className="spin" />
          <span className="what" title={doing}>
            {doing}
          </span>
          <span className="figures">
            {elapsed && ` · ${elapsedLabel(elapsed.ms)}`}
            {working &&
              turnTokens > 0 &&
              ` · ↓ ${tokensLabel(turnTokens)} jetons`}
            {elapsed?.call && backgroundHint && (
              <span className="bg-hint"> · Ctrl+B : en arrière-plan</span>
            )}
          </span>
        </span>
      )}
      {subagents.length > 0 && (
        <span className="chat-agents-done" onClick={() => onOpenAgents()}>
          <Bot /> Agents terminés ({subagents.length})
        </span>
      )}
      {tasks.length > 0 && (
        <span className="chat-anchor">
          <span className="chat-chip" onClick={() => setTasksOpen((o) => !o)}>
            <ListChecks /> Tâches {done}/{tasks.length}
          </span>
          {tasksOpen && (
            <div
              className="chat-tasks"
              onMouseLeave={() => setTasksOpen(false)}
            >
              {tasks.map((t) => (
                <div
                  key={t.id}
                  className={`t${t.status === "completed" ? " done" : t.status === "in_progress" ? " doing" : ""}`}
                >
                  {t.status === "completed" ? (
                    <CircleCheck />
                  ) : t.status === "in_progress" ? (
                    <CircleDot />
                  ) : (
                    <Circle />
                  )}
                  <span>{t.subject}</span>
                </div>
              ))}
            </div>
          )}
        </span>
      )}
    </div>
  );
}
