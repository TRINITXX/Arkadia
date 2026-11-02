import type { SessionChoice } from "@/lib/chat/chatProtocol";
import { sessionRows, type PickerRow } from "@/lib/chat/chatSlash";
import type { ChatState } from "@/lib/chat/chatState";

/** How many of the folder's sessions a new chat offers, or finds. */
export const WELCOME_SESSIONS = 5;

/**
 * A new chat's welcome, on the desktop and the iPhone: the folder's latest
 * sessions as /resume lists them (one open elsewhere can't be taken), at
 * most `WELCOME_SESSIONS`, `query` finding an older one. No branch: the
 * user always works on main (01/11/2026).
 */
export function welcomeRows(
  sessions: SessionChoice[],
  query: string,
  now: number,
): PickerRow[] {
  return sessionRows(sessions, query, null, now, { branch: false }).slice(
    0,
    WELCOME_SESSIONS,
  );
}

/**
 * What an empty column shows: « Claude démarre… » until Claude Code answers,
 * « Reprise de la conversation… » until a resumed session's past is in, then
 * for a new chat the folder's latest sessions (`ChatStartup`).
 */
export type StartupPhase = "starting" | "resuming" | "welcome" | null;

export function startupPhase(
  state: ChatState,
  /** The chat goes on with a session (its own, `continue`, a restore). */
  resuming: boolean,
  /** Asleep, or opened asleep and still without a session. */
  asleep = state.asleep,
): StartupPhase {
  if (state.closed || state.items.length > 0) return null;
  if (resuming && !state.historyLoaded) return "resuming";
  // Asleep with nothing said (a project opened from the sidebar): its
  // sessions to resume, no Claude Code until the user types.
  if (asleep) return "welcome";
  // Claude Code booted: its commands, or the context it reports at once.
  if (state.commands.length === 0 && state.context === null) return "starting";
  // A past with nothing to show (`continue` in a folder without sessions,
  // where the server sends an empty one): as a new chat.
  return "welcome";
}
