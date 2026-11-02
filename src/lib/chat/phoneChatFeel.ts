import {
  IDLE_CHAT,
  nextActivity,
  type ChatActivity,
} from "@/lib/chat/chatActivity";
import {
  EMPTY_TRACK,
  isLiveEvent,
  stepChatNotify,
  type ChatNotifyTrack,
} from "@/lib/chat/chatNotify";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { SERVER_GONE } from "@/lib/chat/phoneChat";

/**
 * What the iPhone makes felt of the chat on its screen (Alexis's choice of
 * 02/11/2026): Claude done (`failed`: on an error, the usage limit
 * included), or Claude asking (a permission, a question, a plan, an MCP's
 * request, a ❓ round). When is the desktop's notification rule
 * (`stepChatNotify`): never an end the user caused, a local command's
 * answer, an end while subagents still work, nor a reply that asks
 * nothing.
 */
export type PhoneChatFeel = "done" | "failed" | "ask";

export interface PhoneChatWatch {
  track: ChatNotifyTrack;
  activity: ChatActivity;
  /** From `attached` to its end: the chat's life told again, felt once already. */
  replaying: boolean;
  /** The last ends and asks felt (result uuid, request id): never twice. */
  felt: string[];
}

export const NEW_PHONE_WATCH: PhoneChatWatch = {
  track: EMPTY_TRACK,
  activity: IDLE_CHAT,
  replaying: false,
  felt: [],
};

/** Enough to cover any event the PC could send twice. */
const FELT_KEPT = 20;

/** What names an end or an ask, when it has a name. */
function feltKey(event: ChatEvent): string | null {
  if (event.type === "permission" || event.type === "elicitation")
    return `ask:${event.requestId}`;
  if (event.type === "sdk" && typeof event.message.uuid === "string")
    return `end:${event.message.uuid}`;
  return null;
}

/**
 * A batch of the chat's events folded in: its next watch, and what to make
 * felt, at most one (an ask over an end). Nothing for the replay or the
 * catch-up of a chat that opens (`isLiveEvent`), nor for the `closed` the
 * phone pushes itself when the chat's server is gone. Claude Code dying
 * mid-turn (the PC's `closed` with its error) ends the turn: an error.
 */
export function watchPhoneChat(
  watch: PhoneChatWatch,
  events: readonly ChatEvent[],
  now: number,
): { watch: PhoneChatWatch; feel: PhoneChatFeel | null } {
  let { track, activity, replaying, felt } = watch;
  let feel: PhoneChatFeel | null = null;
  for (const event of events) {
    if (event.type === "attached") replaying = true;
    activity = nextActivity(activity, event);
    const live = isLiveEvent(event, replaying, now);
    const step = stepChatNotify(track, event, activity, live, now);
    track = step.track;
    if (event.type === "replayed" || event.type === "closed") replaying = false;
    const gone = event.type === "closed" && event.error === SERVER_GONE;
    if (!step.signal || gone) continue;
    const key = feltKey(event);
    if (key !== null) {
      if (felt.includes(key)) continue;
      felt = [...felt, key].slice(-FELT_KEPT);
    }
    const m = event.type === "sdk" ? event.message : null;
    const failed =
      event.type === "closed"
        ? !!event.error
        : !!m && (m.subtype !== "success" || m.is_error === true);
    const kind: PhoneChatFeel =
      step.signal.kind === "question" ? "ask" : failed ? "failed" : "done";
    if (feel !== "ask") feel = kind;
  }
  return { watch: { track, activity, replaying, felt }, feel };
}
