import type { ChatCommand, PermissionMode } from "@/lib/chat/chatProtocol";
import type { ChatState } from "@/lib/chat/chatState";
import type { ChatStart } from "@/lib/chat/useChatSession";

/**
 * A chat whose server stopped resumes by itself (`chatLive`): Arkadia starts
 * another server on the first command, and each chat of that account starts
 * again on its session, its column kept as it was. The turn that was cut is
 * not run again; the column says it was cut (`cut`).
 */

/** At most this many automatic resumes of a chat… */
export const AUTO_RESUMES = 3;
/** …in this window: past that, the server keeps dying and « Reprendre » waits for a click. */
export const AUTO_RESUME_WINDOW_MS = 2 * 60_000;

/** One more automatic resume, if the chat has some left: the times kept, and whether it may. */
export function mayAutoResume(
  times: readonly number[],
  now: number,
): { times: number[]; ok: boolean } {
  const kept = times.filter((t) => now - t < AUTO_RESUME_WINDOW_MS);
  if (kept.length >= AUTO_RESUMES) return { times: kept, ok: false };
  return { times: [...kept, now], ok: true };
}

const MODES = new Set<string>([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
]);

type Start = Omit<Extract<ChatCommand, { type: "start" }>, "type" | "chatId">;

/**
 * The start that resumes a chat its server lost: its session as the page
 * knows it (none after /clear: a fresh one), at a /rewind's cut still
 * pending, its model, mode and effort, asleep if it was. A column already shown keeps its past (`keep`); one that
 * never loaded asks for it as its first start did.
 */
export function restartStart(state: ChatState, start: ChatStart): Start {
  const shown = state.historyLoaded || state.items.length > 0;
  const session = state.sessionId
    ? { resume: state.sessionId }
    : shown
      ? {}
      : { resume: start.resume, continue: start.continue };
  // A /rewind nothing was sent after: resumed at its cut, never past it.
  const cut =
    state.rewind && state.sessionId
      ? {
          historyBefore: state.rewind.before,
          resumeSessionAt: state.rewind.at,
        }
      : {};
  return {
    cwd: start.cwd,
    ...session,
    ...cut,
    permissionMode:
      state.mode && MODES.has(state.mode)
        ? (state.mode as PermissionMode)
        : undefined,
    model: state.model ?? undefined,
    effort: state.sdk.effort ?? undefined,
    keep: shown || undefined,
    cut: (state.working && !state.asleep) || undefined,
    asleep: state.asleep || undefined,
  };
}
