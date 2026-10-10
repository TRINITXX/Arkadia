export type AgentStateValue =
  | { kind: "none" }
  | { kind: "idle"; session_id: string }
  | { kind: "busy"; tool?: string | null }
  | { kind: "waiting"; session_id: string; shellRunning?: boolean };

export interface AgentEventPayload {
  session_id: string;
  cwd: string;
  state: AgentStateValue;
}

export function isActive(s: AgentStateValue): boolean {
  return s.kind === "busy" || s.kind === "waiting";
}

// Claude Code mirrors its live status into the terminal title: it prefixes the
// title with "✳ …" while waiting for a message, and with an animated spinner
// glyph while working (a single Braille dot that hops position frame to frame —
// what looks like a dot bouncing left/right). This is the real-time, per-pane
// truth.
export const WAITING_TITLE_CHAR = "✳"; // U+2733

// True if `ch` is a leading title status glyph Claude Code stamps in. Detection
// is glyph-agnostic on purpose: Claude Code's spinner cycles through characters
// (Braille U+2800–U+28FF, middots, asterisks…) we can't reliably enumerate, so
// instead of an allowlist we key off structure. A plain terminal title starts
// with an alphanumeric (a drive letter `C:\…`, a program name, a URL); Claude's
// status prefix is always a leading SYMBOL. So any single non-alphanumeric char
// is a status glyph. This survives Claude Code changing its exact spinner set.
export function isStatusGlyph(ch: string): boolean {
  return ch !== "" && !/[\p{L}\p{N}]/u.test(ch);
}

// Derive the agent state from a pane's terminal title, or null if the title
// carries no Claude marker (a plain shell / tool title → no badge): ✳ ⇒ waiting,
// any other leading symbol ⇒ busy (working spinner).
export function stateFromTitle(title: string): AgentStateValue | null {
  const first = title.trimStart().charAt(0);
  if (first === WAITING_TITLE_CHAR) return { kind: "waiting", session_id: "" };
  if (isStatusGlyph(first)) return { kind: "busy" };
  return null;
}

// The title flips to ✳ whenever Claude's own turn ends, even while background
// subagents or workflows run and it will resume on its own. The
// notify hook counts those tasks; while any remain, Claude isn't waiting on the
// user, so the pane reads as busy.
export function withBackgroundTasks(
  state: AgentStateValue,
  backgroundTasks: number,
): AgentStateValue {
  if (state.kind !== "waiting" || backgroundTasks <= 0) return state;
  return { kind: "busy", tool: "tâche de fond" };
}

// A background shell (a dev server, a long build) doesn't make Claude resume,
// so the pane stays waiting; the badge only gets a ring saying one is open.
export function withBackgroundShells(
  state: AgentStateValue,
  backgroundShells: number,
): AgentStateValue {
  if (state.kind !== "waiting" || backgroundShells <= 0) return state;
  return { ...state, shellRunning: true };
}

export function aggregate(states: AgentStateValue[]): AgentStateValue {
  // waiting outranks busy because it requires user action (AskUserQuestion,
  // ExitPlanMode) — it must be surfaced even when other agents are working.
  const order: Record<AgentStateValue["kind"], number> = {
    waiting: 4,
    busy: 3,
    idle: 2,
    none: 1,
  };
  // Between two waiting panes, the one with a shell open keeps its ring.
  const rank = (s: AgentStateValue) =>
    order[s.kind] * 2 + (s.kind === "waiting" && s.shellRunning ? 1 : 0);
  return states.reduce<AgentStateValue>(
    (best, s) => (rank(s) > rank(best) ? s : best),
    { kind: "none" },
  );
}
