import type { AgentStateValue } from "@/lib/agentState";

interface AgentBadgeProps {
  state: AgentStateValue;
  size?: number;
  inline?: boolean;
}

type Ring = "question" | "shell" | "artifact";

// Rings stack outward, innermost first: the outline, then ::after, then
// ::before. Each keeps a gap (outline-offset and the pseudo-elements' inset
// stay transparent whatever the row background).
const RING_LAYERS = [
  " outline-[length:1.5px] outline-offset-[1.5px]",
  " after:pointer-events-none after:absolute after:-inset-[6px] after:rounded-full after:border-[1.5px]",
  " before:pointer-events-none before:absolute before:-inset-[9px] before:rounded-full before:border-[1.5px]",
];
// Spelled out per layer so Tailwind's scanner sees every class.
const RING_COLORS: Record<Ring, string[]> = {
  question: [
    " outline-emerald-400",
    " after:border-emerald-400",
    " before:border-emerald-400",
  ],
  shell: [
    " outline-blue-400",
    " after:border-blue-400",
    " before:border-blue-400",
  ],
  artifact: [
    " outline-purple-400",
    " after:border-purple-400",
    " before:border-purple-400",
  ],
};

export function AgentBadge({
  state,
  size = 8,
  inline = false,
}: AgentBadgeProps) {
  if (state.kind === "none" || state.kind === "idle") return null;
  // Questions Claude asked and the user hasn't answered: green ring. A
  // background shell still open while Claude waits: blue ring. An artifact
  // open in the tab: violet ring.
  const question = !!state.questionPending;
  const shell = state.kind === "waiting" && !!state.shellRunning;
  const artifact = !!state.artifactOpen;
  const rings: Ring[] = [];
  if (question) rings.push("question");
  if (shell) rings.push("shell");
  if (artifact) rings.push("artifact");
  const ringCls = rings
    .map((ring, layer) => RING_LAYERS[layer] + RING_COLORS[ring][layer])
    .join("");
  const cls =
    state.kind === "busy"
      ? `bg-amber-500 agent-badge-busy${ringCls}`
      : `bg-emerald-500${ringCls}`;
  const tooltip = [
    state.kind === "busy"
      ? state.tool
        ? `Claude bosse: ${state.tool}…`
        : "Claude bosse…"
      : "Claude attend une réponse",
    ...(question ? ["des questions t'attendent"] : []),
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
