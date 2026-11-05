// When the chat server compacts a session itself (`Chat.compactIfDue`),
// sending `/compact` as if typed. Claude Code refuses a plugin's compaction
// in an SDK session (« $.session.compact: not available in a headless (-p /
// SDK) session », checked 05/11/2026), so the `cache-compact` mod does
// nothing in a chat; and a chat puts its Claude Code to sleep (30 min)
// before Claude Code's own idle compaction (~54 min) could start. Pure.

/** Past this at a turn's end, the conversation is compacted: the `cache-compact` mod's threshold. */
export const TURN_COMPACT_MIN_TOKENS = 500_000;

/** A turn's end waits this long: a message queued then starts the next turn instead. */
export const TURN_COMPACT_SETTLE_MS = 3_000;

/** Past this, a chat left alone is compacted before its cache expires (`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`). */
export const IDLE_COMPACT_MIN_TOKENS = 400_000;

/** When in its cache's life: 90 %, as Claude Code's own (54 min of 1 h). */
const IDLE_COMPACT_AT = 0.9;

/**
 * Past this before the cache expires, it is too late: the next message's
 * handoff takes over. A 5-min cache never gets one (its 90 % falls past it).
 */
const IDLE_COMPACT_MARGIN_MS = 60_000;

/** Who compacted: the turn's end, or the chat left alone. */
export type AutoCompact = "turn" | "idle";

export interface CompactFacts {
  /** The context the main thread's last request read (`ColdFacts`). */
  tokens: number;
  /** When that request was, in ms. */
  at: number;
  /** How long the cache it wrote lives. */
  ttlMs: number;
  /**
   * Something runs or waits that a compaction would hold up: a turn, a
   * message not taken, a question to the user, a `!` command, a subagent
   * or workflow (shells and monitors never), a handoff, a compaction.
   */
  busy: boolean;
  /** The request an idle compaction was last tried after: never twice for it. */
  idleTried: number | null;
}

/** The fields of a `result` that say how its turn ended. */
export interface TurnEnd {
  subtype: string;
  is_error?: boolean;
  num_turns?: number;
  terminal_reason?: string;
}

/**
 * A turn the model answered to its end: not a local command (/usage,
 * /compact: `num_turns` 0), not an error, not stopped (Esc, a hook).
 */
export function answeredTurn(m: TurnEnd): boolean {
  return (
    m.subtype === "success" &&
    m.is_error !== true &&
    (m.num_turns ?? 0) > 0 &&
    (m.terminal_reason ?? "completed") === "completed"
  );
}

/** A turn just ended big, with nothing else under way. */
export function turnCompactDue(f: CompactFacts): boolean {
  return !f.busy && f.tokens >= TURN_COMPACT_MIN_TOKENS;
}

/**
 * An idle compaction is still to come for the last request: big, not tried
 * yet, its cache alive long enough. The chat stays awake for it.
 */
export function idleCompactAhead(f: CompactFacts, now: number): boolean {
  return (
    f.tokens >= IDLE_COMPACT_MIN_TOKENS &&
    f.idleTried !== f.at &&
    now - f.at < f.ttlMs - IDLE_COMPACT_MARGIN_MS
  );
}

/** The chat left alone long enough: compacted while its cache still serves. */
export function idleCompactDue(f: CompactFacts, now: number): boolean {
  return !f.busy && idleCompactAhead(f, now) && now - f.at >= f.ttlMs * IDLE_COMPACT_AT;
}

/** The server's own `/compact` under way (`Chat.autoCompact`). */
export interface OwnCompact {
  uuid: string;
  /** Claude Code took it (its « started » frame). */
  running: boolean;
}

/**
 * This `result` ends the server's own `/compact`: taken by Claude Code, or
 * naming its message (`user_message_uuids`) when its « started » frame never
 * came, which would leave it wedged, the chat never asleep again.
 */
export function endsOwnCompact(
  own: OwnCompact | null,
  m: { type: string; user_message_uuids?: unknown },
): boolean {
  if (!own || m.type !== "result") return false;
  return own.running || (Array.isArray(m.user_message_uuids) && m.user_message_uuids.includes(own.uuid));
}
