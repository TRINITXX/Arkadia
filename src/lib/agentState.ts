export type AgentStateValue =
  | { kind: "none" }
  | { kind: "idle"; session_id: string }
  | { kind: "busy"; tool?: string | null }
  | { kind: "waiting"; session_id: string };

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

export function aggregate(states: AgentStateValue[]): AgentStateValue {
  // waiting outranks busy because it requires user action (AskUserQuestion,
  // ExitPlanMode) — it must be surfaced even when other agents are working.
  const order: Record<AgentStateValue["kind"], number> = {
    waiting: 4,
    busy: 3,
    idle: 2,
    none: 1,
  };
  return states.reduce<AgentStateValue>(
    (best, s) => (order[s.kind] > order[best.kind] ? s : best),
    { kind: "none" },
  );
}
