import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, OctagonX } from "lucide-react";
import { elapsedLabel, tokensLabel } from "@/lib/chat/chatLabels";
import type { Subagent } from "@/lib/chat/chatState";
import { toolStep } from "@/lib/chat/chatSteps";
import { useChatLayer } from "@/lib/chat/useChatLayers";

/** The pointer crosses the gap to a pill's detail within this. */
const CLOSE_AFTER_MS = 180;
/** A stop sent and the agent still running this long: the button again. */
const STOP_RETRY_MS = 10_000;
/** Between two pills, and the « +N » pill's room, as the CSS draws them. */
const GAP_PX = 6;
const MORE_PX = 48;
/** The hover key of the « +N » pill. */
const MORE = "+";

/** A pill's stop: asked, or sent (when, to which run of the agent). */
type StopState =
  | { step: "ask" }
  | { step: "sent"; at: number; run: number | undefined };

/** How long it has run, or ran. */
const elapsedOf = (agent: Subagent, now: number) =>
  agent.startedAt ? (agent.endedAt ?? now) - agent.startedAt : agent.durationMs;

const figures = (agent: Subagent, now: number) =>
  [
    elapsedLabel(elapsedOf(agent, now)),
    agent.tokens > 0 && `${tokensLabel(agent.tokens)} tokens`,
  ]
    .filter(Boolean)
    .join(" · ");

function StatusIcon({ agent }: { agent: Subagent }) {
  if (agent.status === "running") return <span className="spin" />;
  return agent.status === "completed" ? (
    <CircleCheck className="ok" />
  ) : (
    <CircleAlert className="ko" />
  );
}

/**
 * The running subagents above the input, one pill each (title, time): the
 * user's pick C+ of 01/11/2026, in place of a card each. Hovered, a pill
 * shows its detail (what it does, its last action, time and tokens) and its
 * stop, behind a confirmation (`stopTask`); a click opens its conversation.
 * Too many for the width: the titles shorten, then « +N » lists the rest on
 * hover. One that ends shows ✓ a moment, then leaves (`agentCards`).
 */
export function ChatAgentCards({
  agents,
  cwd,
  now,
  onOpen,
  onStop,
}: {
  /** Already filtered: running, or just ended (`agentCards`). */
  agents: Subagent[];
  cwd: string | null;
  now: number;
  onOpen: (agent: Subagent) => void;
  /** Stops a running subagent (its task id); absent, no stop button. */
  onStop?: (taskId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(agents.length);
  const [hover, setHover] = useState<string | null>(null);
  const [stops, setStops] = useState<Record<string, StopState>>({});
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Esc closes a detail (or its question), never Claude's turn.
  useChatLayer(hover !== null, () => setHover(null));

  // As many pills as the row holds, measured on a hidden twin of them.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const compute = () => {
      const width = row.clientWidth;
      const widths = [...measure.children].map(
        (c) => (c as HTMLElement).offsetWidth,
      );
      const total = widths.reduce((s, w, i) => s + w + (i ? GAP_PX : 0), 0);
      let n = widths.length;
      if (total > width) {
        let used = 0;
        n = 0;
        for (const w of widths) {
          const next = used + (n ? GAP_PX : 0) + w;
          if (next + GAP_PX + MORE_PX > width) break;
          used = next;
          n++;
        }
      }
      setFit((f) => (f === n ? f : n));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(row);
    return () => observer.disconnect();
  });

  if (agents.length === 0) return null;
  const show = (key: string) => {
    window.clearTimeout(timer.current);
    setHover(key);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(null), CLOSE_AFTER_MS);
  };
  // A detail or the « +N » list kept inside the row: shifted, never cut.
  const keepInRow = (el: HTMLElement | null) => {
    const row = rowRef.current;
    if (!el || !row) return;
    el.style.transform = "";
    const box = row.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx =
      r.left < box.left
        ? box.left - r.left
        : r.right > box.right
          ? box.right - r.right
          : 0;
    if (dx) el.style.transform = `translateX(${dx}px)`;
  };
  const shown = agents.slice(0, fit);
  const rest = agents.slice(fit);
  const pill = (agent: Subagent) => (
    <>
      <StatusIcon agent={agent} />
      <span className="name">{agent.description || "Sous-agent"}</span>
      <span className="t">{elapsedLabel(elapsedOf(agent, now))}</span>
    </>
  );
  return (
    <div className="chat-agent-pills" ref={rowRef}>
      <div className="measure" ref={measureRef} aria-hidden>
        {agents.map((agent) => (
          <span key={agent.taskId} className="chat-agent-pill">
            {pill(agent)}
          </span>
        ))}
      </div>
      {shown.map((agent) => (
        <span
          key={agent.taskId}
          className="chat-anchor"
          onMouseEnter={() => show(agent.taskId)}
          onMouseLeave={hide}
        >
          <span
            className={`chat-agent-pill${agent.status === "running" ? "" : " ended"}${hover === agent.taskId ? " on" : ""}`}
            title="Ouvrir sa conversation"
            onClick={() => onOpen(agent)}
          >
            {pill(agent)}
          </span>
          {hover === agent.taskId && (
            <AgentDetail
              agent={agent}
              cwd={cwd}
              now={now}
              stop={stops[agent.taskId]}
              onStopState={(s) =>
                setStops((all) => {
                  const next = { ...all };
                  if (s) next[agent.taskId] = s;
                  else delete next[agent.taskId];
                  return next;
                })
              }
              onStop={onStop && (() => onStop(agent.taskId))}
              boxRef={keepInRow}
            />
          )}
        </span>
      ))}
      {rest.length > 0 && (
        <span
          className="chat-anchor"
          onMouseEnter={() => show(MORE)}
          onMouseLeave={hide}
        >
          <span
            className={`chat-agent-pill more${hover === MORE ? " on" : ""}`}
          >
            +{rest.length}
          </span>
          {hover === MORE && (
            <div
              className="chat-menu chat-agent-more"
              style={{ right: 0 }}
              ref={keepInRow}
            >
              {rest.map((agent) => (
                <button
                  key={agent.taskId}
                  type="button"
                  title="Ouvrir sa conversation"
                  onClick={() => {
                    setHover(null);
                    onOpen(agent);
                  }}
                >
                  <span className="h">
                    <StatusIcon agent={agent} />
                    <b>{agent.description || "Sous-agent"}</b>
                  </span>
                  <span className="m">{figures(agent, now)}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      )}
    </div>
  );
}

/** A pill's detail on hover: what it does, its last action, figures, stop. */
function AgentDetail({
  agent,
  cwd,
  now,
  stop,
  onStopState,
  onStop,
  boxRef,
}: {
  agent: Subagent;
  cwd: string | null;
  now: number;
  stop: StopState | undefined;
  onStopState: (stop: StopState | null) => void;
  onStop?: () => void;
  /** Keeps the detail inside the row (`keepInRow`). */
  boxRef: (el: HTMLDivElement | null) => void;
}) {
  const running = agent.status === "running";
  const asking = running && stop?.step === "ask";
  // No end within STOP_RETRY_MS (the stop failed or went unheard), or the
  // agent run again (SendMessage): the button is back.
  const stopping =
    running &&
    stop?.step === "sent" &&
    stop.run === agent.startedAt &&
    now - stop.at < STOP_RETRY_MS;
  // Its AI summary comes every ~30 s; before it, the line is its last action.
  const summary = agent.summary?.split("\n")[0];
  const action = agent.lastAction
    ? toolStep(agent.lastAction.name, agent.lastAction.input, cwd)
    : null;
  return (
    <div
      className="chat-menu chat-agent-detail"
      style={{ left: 0 }}
      ref={boxRef}
    >
      <div className="h">
        <StatusIcon agent={agent} />
        <b>{agent.description || "Sous-agent"}</b>
      </div>
      {stopping ? (
        <div className="s">arrêt demandé…</div>
      ) : agent.retry ? (
        <div className="s retry">
          réessaie ({agent.retry.attempt}/{agent.retry.max})
          {agent.retry.status ? ` · erreur ${agent.retry.status}` : ""}
        </div>
      ) : (
        <div className="s">{summary || action || "démarre…"}</div>
      )}
      {summary && action && <div className="a">↳ {action}</div>}
      {/* Figures and stop share a line: no row left empty. */}
      <div className="f">
        <span>{figures(agent, now)}</span>
        {running && onStop && !stopping && (
          <span className="stop">
            {asking ? (
              <>
                <span>Arrêter ?</span>
                <button
                  type="button"
                  className="chat-btn danger"
                  onClick={() => {
                    onStopState({
                      step: "sent",
                      at: now,
                      run: agent.startedAt,
                    });
                    onStop();
                  }}
                >
                  Oui, arrêter
                </button>
                <button
                  type="button"
                  className="chat-btn"
                  onClick={() => onStopState(null)}
                >
                  Annuler
                </button>
              </>
            ) : (
              <button
                type="button"
                className="chat-btn"
                onClick={() => onStopState({ step: "ask" })}
              >
                <OctagonX /> Arrêter
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
