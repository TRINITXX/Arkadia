import type { ChatState } from "@/lib/chat/chatState";

/**
 * A new turn starts, whoever opens it (the user's message or command, or
 * Claude's own first reply: a task's report, a wakeup, another session's
 * message, a message held behind a `!` command): its clock and its token
 * count from zero. Mid-turn (a message queued behind it), nothing changes.
 * Every path that starts a turn goes through here, or the live line's
 * « ↓ N tokens » would add the last turn's.
 */
export function startTurn(state: ChatState, now: number): ChatState {
  if (state.working) return state;
  return { ...state, working: true, turnStartedAt: now, turnTokens: 0 };
}
