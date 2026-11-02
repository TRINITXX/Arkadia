import { useEffect, useRef, useState } from "react";
import { Circle, CircleCheck, CircleDot } from "lucide-react";
import { ChatAgentsMenu } from "@/components/chat/chat-agents-menu";
import { retryLabel, type RetryInfo } from "@/lib/chat/chatErrors";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent, TaskItem } from "@/lib/chat/chatState";
import { liveElapsed } from "@/lib/chat/chatSteps";
import { taskLine } from "@/lib/chat/chatTaskLine";
import { useChatLayer } from "@/lib/chat/useChatLayers";
import { useChatShown } from "@/lib/chat/useChatShown";

/**
 * What the terminal shows above its input while Claude works, the one line
 * that says it: the spinner, the step it is on (« lit chatState.ts »,
 * `liveStep`), one time (the running call's, else the turn's: `liveElapsed`)
 * and the turn's tokens (thinking's estimate included); the subagents just
 * finished (a menu on hover). With a task list, the step is its task in
 * progress: a green dot per task done before it, the next one in grey, the
 * whole list on hover; never « 3 sur 7 », the list changes on the way (the
 * user's pick B of 01/11/2026).
 */
export function ChatLiveLine({
  working,
  compacting,
  step,
  turnStartedAt,
  turnTokens,
  subagents,
  tasks,
  onOpenAgent,
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
  /** A finished agent picked in its menu: its conversation. */
  onOpenAgent: (agent: Subagent) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [tasksOpen, setTasksOpen] = useState(false);
  // The list opens after the pointer rests a moment, as a pill's detail.
  const openTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(openTimer.current), []);
  const hoverTasks = {
    onMouseEnter: () => {
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => setTasksOpen(true), 500);
    },
    onMouseLeave: () => {
      window.clearTimeout(openTimer.current);
      setTasksOpen(false);
    },
  };
  // Its clock stops while the tab is hidden, and is right again on return.
  const shown = useChatShown();
  useEffect(() => {
    if (!working || !shown) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [working, shown]);

  // The same line as the iPhone's (`taskLine`).
  const { done, current, next, open: openTasks } = taskLine(tasks);
  const quiet = !working && !hook && subagents.length === 0 && !openTasks;
  // Esc closes the tasks shown, never Claude's turn (`chatLayers`).
  useChatLayer(tasksOpen && tasks.length > 0 && !quiet, () =>
    setTasksOpen(false),
  );
  // The dots move (task under way or not) or go: the list closes with
  // them, never left open under no pointer (no mouseleave then).
  const onTaskNow = !!(working && current && !compacting && !retry && !hook);
  useEffect(() => {
    window.clearTimeout(openTimer.current);
    setTasksOpen(false);
  }, [onTaskNow, quiet]);
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
  // The task list: its dots (done, then the one under way), the list on hover.
  const taskList = (
    <span className="chat-anchor" {...hoverTasks}>
      <span className="chat-task-dots">
        {done.map((t) => (
          <i key={t.id} />
        ))}
        {current && <i className="cur" />}
      </span>
      {tasksOpen && (
        <div className="chat-tasks">
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
  );
  // Claude works on a task of its list: that task is the line, the call
  // under way on hover. A retry, a compaction or a hook still say theirs.
  const onTask = working && current && !compacting && !retry && !hook;
  return (
    <div className="chat-live">
      {onTask && (
        <span className="chat-live-now">
          <span className="spin" />
          {taskList}
          <span className="what" title={step}>
            {current.subject}
          </span>
          {next && <span className="then">· ensuite : {next.subject}</span>}
          <span className="figures">
            {elapsed && ` · ${elapsedLabel(elapsed.ms)}`}
            {turnTokens > 0 && ` · ↓ ${tokensLabel(turnTokens)} tokens`}
            {elapsed?.call && backgroundHint && (
              <span className="bg-hint"> · Ctrl+B : en arrière-plan</span>
            )}
          </span>
        </span>
      )}
      {!onTask && (working || hook) && (
        <span className={`chat-live-now${retry ? " retry" : ""}`}>
          <span className="spin" />
          <span className="what" title={doing}>
            {doing}
          </span>
          <span className="figures">
            {elapsed && ` · ${elapsedLabel(elapsed.ms)}`}
            {working &&
              turnTokens > 0 &&
              ` · ↓ ${tokensLabel(turnTokens)} tokens`}
            {elapsed?.call && backgroundHint && (
              <span className="bg-hint"> · Ctrl+B : en arrière-plan</span>
            )}
          </span>
        </span>
      )}
      {subagents.length > 0 && (
        <ChatAgentsMenu agents={subagents} onOpen={onOpenAgent} />
      )}
      {/* Tasks left with no task under way (paused, or between two):
          the dots and what comes next, never a total. */}
      {!onTask && openTasks && (
        <span className="chat-live-now">
          {taskList}
          {next && <span className="then">ensuite : {next.subject}</span>}
        </span>
      )}
    </div>
  );
}
