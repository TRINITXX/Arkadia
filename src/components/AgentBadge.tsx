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
  // A background shell still open while Claude waits: blue ring. An artifact
  // open in the tab: violet ring. Both: blue inside, violet outside. Each ring
  // keeps a gap (outline-offset stays transparent whatever the row background).
  const shell = state.kind === "waiting" && !!state.shellRunning;
  const artifact = !!state.artifactOpen;
  const ringCls = (color: string) =>
    ` outline-[length:1.5px] outline-offset-[1.5px] ${color}`;
  const rings = shell
    ? ringCls("outline-blue-400") +
      (artifact
        ? " after:pointer-events-none after:absolute after:-inset-[6px] after:rounded-full after:border-[1.5px] after:border-purple-400"
        : "")
    : artifact
      ? ringCls("outline-purple-400")
      : "";
  const cls =
    state.kind === "busy"
      ? `bg-amber-500 agent-badge-busy${rings}`
      : `bg-emerald-500${rings}`;
  const tooltip = [
    state.kind === "busy"
      ? state.tool
        ? `Claude bosse: ${state.tool}…`
        : "Claude bosse…"
      : "Claude attend une réponse",
    ...(shell ? ["un shell tourne en arrière-plan"] : []),
    ...(artifact ? ["un artefact est ouvert"] : []),
  ].join(" · ");
  const positionCls = inline
    ? "relative inline-block"
    : "absolute -top-0.5 -right-0.5";
  return (
    <span
      title={tooltip}
      className={`${positionCls} rounded-full ring-1 ring-zinc-900/50 ${cls}`}
      style={{ width: size, height: size }}
    />
  );
}
