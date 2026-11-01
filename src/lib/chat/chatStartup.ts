import type { ChatState } from "@/lib/chat/chatState";

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
