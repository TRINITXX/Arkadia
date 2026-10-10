import type { AgentStateValue } from "@/lib/agentState";

interface AgentBadgeProps {
  state: AgentStateValue;
  size?: number;
  inline?: boolean;
}

export function AgentBadge({
  state,
  size = 8,
  inline = false,
}: AgentBadgeProps) {
  if (state.kind === "none" || state.kind === "idle") return null;
  // A background shell still open while Claude waits: blue ring, with a gap
  // (outline-offset stays transparent whatever the row background).
  const shellRing =
    state.kind === "waiting" && state.shellRunning
      ? " outline-[length:1.5px] outline-offset-[1.5px] outline-blue-400"
      : "";
  const cls =
    state.kind === "busy"
      ? "bg-amber-500 agent-badge-busy"
      : `bg-emerald-500${shellRing}`;
  const tooltip =
    state.kind === "busy"
      ? state.tool
        ? `Claude bosse: ${state.tool}…`
        : "Claude bosse…"
      : state.shellRunning
        ? "Claude attend une réponse · un shell tourne en arrière-plan"
        : "Claude attend une réponse";
  const positionCls = inline ? "inline-block" : "absolute -top-0.5 -right-0.5";
  return (
    <span
      title={tooltip}
      className={`${positionCls} rounded-full ring-1 ring-zinc-900/50 ${cls}`}
      style={{ width: size, height: size }}
    />
  );
}
