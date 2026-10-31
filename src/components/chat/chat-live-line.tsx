import { useEffect, useState } from "react";
import { Bot, Circle, CircleCheck, CircleDot, ListChecks } from "lucide-react";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent, TaskItem } from "@/lib/chat/chatState";

/**
 * What the terminal shows above its input while Claude works: the spinner,
 * the step it is on (« lit chatState.ts », `liveStep`), the time and tokens
 * of the turn; and its running subagents and task list, one click away.
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
}: {
  working: boolean;
  compacting: boolean;
  step: string;
  turnStartedAt: number | null;
  turnTokens: number;
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

  const running = subagents.filter((s) => s.status === "running").length;
  const done = tasks.filter((t) => t.status === "completed").length;
  const openTasks = tasks.length > 0 && done < tasks.length;
  if (!working && running === 0 && !openTasks)
    return <div className="chat-live" />;

  const doing = compacting ? "compacte la conversation" : step;
  return (
    <div className="chat-live">
      {working && (
        <span className="chat-live-now">
          <span className="spin" />
          <span className="what" title={doing}>
            {doing}
          </span>
          <span className="figures">
            {turnStartedAt !== null &&
              ` · ${elapsedLabel(now - turnStartedAt)}`}
            {turnTokens > 0 && ` · ↓ ${tokensLabel(turnTokens)} jetons`}
          </span>
        </span>
      )}
      {subagents.length > 0 && (
        <span className="chat-chip" onClick={onOpenAgents}>
          <Bot />{" "}
          {running > 0
            ? `${running} sous-agent${running > 1 ? "s" : ""}`
            : "Sous-agents"}
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
