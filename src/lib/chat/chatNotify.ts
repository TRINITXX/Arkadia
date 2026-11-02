import type { PaneBackground } from "@/lib/agentState";
import type { ChatActivity } from "@/lib/chat/chatActivity";
import { stoppedByUser } from "@/lib/chat/chatErrors";
import { peerMessages } from "@/lib/chat/chatPeer";
import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { parseQuestionRound } from "@/lib/chat/chatQuestionRound";
import {
  isInterruptNote,
  isStandIn,
  visibleUserText,
} from "@/lib/chat/chatState";

/**
 * When a chat pane notifies, from its events alone: no hook writes for a
 * chat (`arkadia-notify.ps1` skips `ARKADIA_CHAT`). The rules of a terminal
 * pane's hook (`lib\subagent-gate.ps1`), decided with Alexis on 31/10/2026:
 * - a turn's end notifies (`done`), an error, the usage limit or Claude
 *   Code gone mid-turn included, never an end the user caused (Esc) nor a
 *   local command's answer;
 * - Claude waiting on the user notifies at once (`question`): a permission,
 *   AskUserQuestion, ExitPlanMode, an MCP's request, or a ❓ round in a
 *   reply of the turn, as the sheet shows it (`lastReplyRound`: after the
 *   user's last message, no API error last);
 * - an end stays silent while background subagents, workflows or a
 *   Monitor (until its timeout) run (shells never count), and when it asks
 *   nothing (« No response requested. », a lone ⏳ last line), unless an
 *   end was kept silent for background work since the last notice: late
 *   rather than never;
 * - a turn Claude opened on its own (a task's report, another session's
 *   message, a wakeup) is `selfWoken`: Rust mutes it once that pane already
 *   notified while the user was away (`mute_self_woken`). A turn it can't
 *   place is the user's, as the hook's `Test-TurnSelfWoken` has it.
 * Only live events notify (`isLiveEvent`): a replay rebuilds the state.
 */

export interface ChatSignal {
  kind: "done" | "question";
  selfWoken: boolean;
  /** A ❓ round: it rings as a question, but counts as an end for the one
   *  notice per tab while away (a terminal's round comes as a Stop). */
  round: boolean;
}

/** Who opened the turn under way: the user (typed, an artifact comment),
 *  Claude itself, or nothing seen yet (the user's, failing open). */
type Opener = "user" | "self" | null;

export interface ChatNotifyTrack {
  /** Claude was in a turn before this event (`ChatActivity.busy`). */
  busy: boolean;
  opener: Opener;
  /** The user's messages sent mid-turn and not taken yet, by uuid (`?`: an
   *  older server's, without one): the turn that takes them answers him. */
  queued: string[];
  /** A scheduled wakeup fired: the next prompt without origin is Claude's. */
  scheduled: boolean;
  /** Claude's latest reply (main loop) is an API error: no round shows
   *  until another comes (`lastReplyRound`). */
  replyError: boolean;
  /** A reply of this turn asks a ❓ round (not only its last words), since
   *  the user's last message. */
  turnRound: boolean;
  /** A reply since the user's last message asks a ❓ round, in this turn or
   *  an earlier one: the round the sheet gathers (`lastReplyRound`). */
  roundAsked: boolean;
  /** The text of the turn's last assistant message, null when that message
   *  holds anything else (a tool call): a turn that asks nothing? */
  endText: string | null;
  /** Claude Code's « [Request interrupted by user] » in this turn. */
  interrupted: boolean;
  /** An end kept silent for background work, no notice since. */
  silenced: boolean;
  /** The ❓ round the sheet shows waits for the user, from a turn's end
   *  until his next message (`roundAsked`, no `replyError`). */
  roundPending: boolean;
  /** Open AskUserQuestion requests. */
  asks: string[];
  /** Non-persistent Monitors, by task id: when each times out (epoch ms). */
  monitors: Record<string, number>;
}

export const EMPTY_TRACK: ChatNotifyTrack = {
  busy: false,
  opener: null,
  queued: [],
  scheduled: false,
  replyError: false,
  turnRound: false,
  roundAsked: false,
  endText: null,
  interrupted: false,
  silenced: false,
  roundPending: false,
  asks: [],
  monitors: {},
};

/** Events older than this come from a replay, not from now. */
export const FRESH_MS = 60_000;

/**
 * Whether an event happens now. A reattach (page reloaded, pane mounted
 * again) replays the chat's life between `attached` and `replayed`
 * (`chatReplaying`), each event stamped when it first happened (`at`).
 */
export function isLiveEvent(
  event: ChatEvent,
  replaying: boolean,
  now: number,
): boolean {
  if (replaying || event.type === "attached") return false;
  const at = (event as { at?: unknown }).at;
  return typeof at !== "number" || now - at <= FRESH_MS;
}

const NO_REPLY = /^\s*No response requested\.?\s*$/i;
const WAIT_MARK = "⏳";

/**
 * A reply that asks nothing of the user (`Test-NoReplyTurn`): Claude Code's
 * stock « No response requested. », or a lone ⏳ last line (the rule of
 * Alexis's CLAUDE.md, maybe written as inline code).
 */
export function isNoReplyText(text: string | null): boolean {
  if (text === null) return false;
  if (NO_REPLY.test(text)) return true;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (last === undefined) return false;
  return last.replace(/️/g, "").replace(/^[` ]+|[` ]+$/g, "") === WAIT_MARK;
}

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const isRound = (text: string | null) =>
  !!text && parseQuestionRound(text).length > 0;

/**
 * Who a prompt the page doesn't show comes from (`Test-TurnSelfWoken`):
 * another session, a task's report (an artifact comment is the user
 * clicking), a scheduled wakeup or an idle notice are Claude's own; any
 * other, known or not, the user's.
 */
export function openerOf(
  kind: string | null,
  artifact: boolean,
  idleNotice: boolean,
  scheduled: boolean,
): "user" | "self" {
  if (kind === "peer") return "self";
  if (kind === "task-notification") return artifact ? "user" : "self";
  if (!kind) return scheduled || idleNotice ? "self" : "user";
  return "user";
}

/** The first prompt after a turn's end opens the next one. */
function opened(t: ChatNotifyTrack, who: "user" | "self"): ChatNotifyTrack {
  return t.opener === null ? { ...t, opener: who, scheduled: false } : t;
}

/** Claude's words in a message, Claude Code's stand-in aside. */
function textsOf(message: JsonObject): string[] {
  return arr(message.content)
    .map(obj)
    .filter((b) => b.type === "text")
    .map((b) => str(b.text) ?? "")
    .filter((t) => !isStandIn(message, t));
}

/** One assistant message of the main loop (Claude Code sends one per block). */
function addAssistant(t: ChatNotifyTrack, m: JsonObject): ChatNotifyTrack {
  const message = obj(m.message);
  const blocks = arr(message.content)
    .map(obj)
    .filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
  const texts = textsOf(message);
  if (blocks.length === 0) return t;
  // The stand-in alone: never Claude's reply (a usage limit's turn ends on it).
  if (texts.length === 0 && blocks.every((b) => b.type === "text")) return t;
  const last = texts[texts.length - 1];
  // An API error's reply asks nothing, and hides the round until another.
  const errored = typeof m.error === "string";
  const asks = !errored && texts.some((x) => isRound(x));
  return {
    ...t,
    endText: blocks.length === 1 && last !== undefined ? last : null,
    replyError: last === undefined ? t.replyError : errored,
    // A round in any reply of the turn, not only its last words.
    turnRound: t.turnRound || asks,
    roundAsked: t.roundAsked || asks,
  };
}

/**
 * A user message of the main loop: Claude Code's interrupt note, another
 * session's message (it opens a turn of Claude's own), or a Monitor's start:
 * a non-persistent one keeps an end silent until its timeout, as the hook's
 * gate counts it (`"timeoutMs":N,"persistent":false`).
 */
function addUser(
  t: ChatNotifyTrack,
  m: JsonObject,
  when: number,
): ChatNotifyTrack {
  if (isInterruptNote(m)) t = { ...t, interrupted: true };
  if (obj(m.origin).kind === "peer") t = opened(t, "self");
  const result = obj(m.tool_use_result);
  const taskId = str(result.taskId);
  if (taskId && result.persistent === false) {
    const timeout = result.timeoutMs;
    if (typeof timeout === "number")
      t = { ...t, monitors: { ...t.monitors, [taskId]: when + timeout } };
  }
  return t;
}

/** Messages Claude Code took (`takeQueued`): a turn now answers them. */
function takeMessages(t: ChatNotifyTrack, m: JsonObject): ChatNotifyTrack {
  const lifecycle = m.type === "command_lifecycle";
  if (lifecycle && m.state === "queued") return t;
  const uuids = lifecycle ? [m.command_uuid] : arr(m.user_message_uuids);
  const taken = uuids.filter(
    (u): u is string => typeof u === "string" && t.queued.includes(u),
  );
  if (taken.length === 0) return t;
  const cancelled = lifecycle && m.state === "cancelled";
  return {
    ...t,
    queued: t.queued.filter((u) => !taken.includes(u)),
    // Typed by him, even mid-turn: the reply answers him.
    opener: cancelled ? t.opener : "user",
  };
}

/** A message the user wrote, in a resumed session's past. */
function typedByUser(m: JsonObject): boolean {
  if (peerMessages(m)) return false;
  const content = obj(m.message).content;
  if (typeof content === "string") return visibleUserText(content) !== null;
  return arr(content)
    .map(obj)
    .some(
      (b) =>
        b.type === "image" ||
        (b.type === "text" && visibleUserText(str(b.text) ?? "") !== null),
    );
}

/**
 * A resumed session's round, as the sheet reads its column
 * (`lastReplyRound`): any reply since the user's last message may ask it,
 * and Claude's latest may be an API error.
 */
function historyRound(
  messages: JsonObject[],
): Pick<ChatNotifyTrack, "roundAsked" | "replyError"> {
  let replyError: boolean | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.parent_tool_use_id) continue;
    if (m.type === "user" && typedByUser(m)) break;
    if (m.type !== "assistant") continue;
    const texts = textsOf(obj(m.message));
    if (texts.length === 0) continue;
    const errored = typeof m.error === "string";
    replyError ??= errored;
    if (!errored && texts.some((x) => isRound(x)))
      return { roundAsked: true, replyError };
  }
  return { roundAsked: false, replyError: replyError ?? false };
}

/** Background work Claude will resume on: subagents and workflows, and
 *  Monitors until their timeout. Shells never. */
function awaited(
  t: ChatNotifyTrack,
  activity: ChatActivity,
  now: number,
): number {
  const monitors = Object.entries(t.monitors).filter(
    ([id, expires]) => activity.shells.includes(id) && expires > now,
  );
  return activity.tasks.length + monitors.length;
}

type Step = { track: ChatNotifyTrack; signal: ChatSignal | null };
const quiet = (track: ChatNotifyTrack): Step => ({ track, signal: null });

function endTurn(
  t: ChatNotifyTrack,
  m: JsonObject,
  activity: ChatActivity,
  now: number,
): Step {
  // As the sheet shows it: an API error last hides the round.
  const round = t.turnRound && !t.replyError;
  const selfWoken = t.opener === "self";
  const ended: ChatNotifyTrack = {
    ...t,
    // Still waiting: the next turn takes them.
    opener: t.queued.length > 0 ? "user" : null,
    queued: t.queued.filter((u) => u !== "?"),
    scheduled: false,
    turnRound: false,
    endText: null,
    interrupted: false,
    // `lastReplyRound`: the round stays until the user answers, whatever
    // later turns say (its questions may span several replies).
    roundPending: t.roundAsked && !t.replyError,
    // Those that ended are gone from the shells.
    monitors: Object.fromEntries(
      Object.entries(t.monitors).filter(([id]) => activity.shells.includes(id)),
    ),
  };
  if (stoppedByUser(m, t.interrupted)) return quiet(ended);
  // A local command's answer (no model, `endCommandTurn`): typed just now.
  if (m.num_turns === 0 && m.subtype === "success" && m.is_error !== true)
    return quiet(ended);
  const told = { ...ended, silenced: false };
  if (round)
    return {
      track: told,
      signal: { kind: "question", selfWoken, round: true },
    };
  if (awaited(t, activity, now) > 0) return quiet({ ...ended, silenced: true });
  if (isNoReplyText(t.endText) && !t.silenced) return quiet(ended);
  return { track: told, signal: { kind: "done", selfWoken, round: false } };
}

function addSdk(
  t: ChatNotifyTrack,
  m: JsonObject,
  activity: ChatActivity,
  now: number,
  when: number,
): Step {
  // A subagent's own messages: its turn is not Claude's.
  if (m.parent_tool_use_id) return quiet(t);
  t = takeMessages(t, m);
  switch (m.type) {
    case "assistant":
      return quiet(addAssistant(t, m));
    case "user":
      return quiet(addUser(t, m, when));
    case "system":
      return quiet(
        m.subtype === "scheduled_task_fire" ? { ...t, scheduled: true } : t,
      );
    case "conversation_reset":
      return quiet({
        ...t,
        replyError: false,
        turnRound: false,
        roundAsked: false,
        endText: null,
        roundPending: false,
      });
    case "result":
      return endTurn(t, m, activity, now);
    default:
      return quiet(t);
  }
}

const question: ChatSignal = {
  kind: "question",
  selfWoken: false,
  round: false,
};

function step(
  t: ChatNotifyTrack,
  event: ChatEvent,
  activity: ChatActivity,
  now: number,
): Step {
  switch (event.type) {
    case "attached":
      return quiet(EMPTY_TRACK);
    case "closed":
      // Claude Code gone mid-turn on an error (its server too): that
      // turn's end, Claude's own if it opened it.
      return {
        track: EMPTY_TRACK,
        signal:
          t.busy && event.error
            ? { kind: "done", selfWoken: t.opener === "self", round: false }
            : null,
      };
    case "user_sent": {
      // His words: whatever was kept silent, he sees it now. Mid-turn too,
      // they answer the round: the sheet's starts after them in the column.
      const sent = {
        ...t,
        silenced: false,
        turnRound: false,
        roundAsked: false,
        roundPending: false,
      };
      if (!t.busy) return quiet({ ...sent, opener: "user" });
      // Mid-turn, Claude Code takes it now or after the turn (`takeMessages`).
      return quiet({
        ...sent,
        opener: event.uuid ? sent.opener : "user",
        queued: [...t.queued, event.uuid ?? "?"],
      });
    }
    case "user_origin":
      return quiet(
        opened(
          t,
          openerOf(event.kind, event.artifact, event.idleNotice, t.scheduled),
        ),
      );
    case "queued_removed":
      return quiet({ ...t, queued: t.queued.filter((u) => u !== event.uuid) });
    case "permission":
      return {
        track:
          event.toolName === "AskUserQuestion"
            ? { ...t, asks: [...t.asks, event.requestId] }
            : t,
        signal: question,
      };
    case "permission_resolved":
      return t.asks.includes(event.requestId)
        ? quiet({ ...t, asks: t.asks.filter((id) => id !== event.requestId) })
        : quiet(t);
    case "elicitation":
      return { track: t, signal: question };
    case "history": {
      if (event.agentId || event.older || event.unreachable) return quiet(t);
      const past = historyRound(event.messages);
      return quiet({
        ...t,
        ...past,
        roundPending: past.roundAsked && !past.replyError,
      });
    }
    case "sdk": {
      const at = (event as { at?: unknown }).at;
      const when = typeof at === "number" ? at : now;
      return addSdk(t, event.message, activity, now, when);
    }
    default:
      return quiet(t);
  }
}

/**
 * One event of a chat: its next track, and the notification it calls for.
 * `activity`: the chat's activity after the event (`chatActivity`). A replay
 * (`live` false) folds the same way and notifies nothing.
 */
export function stepChatNotify(
  track: ChatNotifyTrack,
  event: ChatEvent,
  activity: ChatActivity,
  live: boolean,
  now: number,
): Step {
  const next = step(track, event, activity, now);
  const synced =
    next.track.busy === activity.busy
      ? next.track
      : { ...next.track, busy: activity.busy };
  return { track: synced, signal: live ? next.signal : null };
}

/**
 * A chat pane's badge rings, from its own state (the hook writes no pane map
 * for a chat): blue while a background shell runs, green while a ❓ round
 * or an AskUserQuestion waits. Busy (amber) is already in its title
 * (`chatTitle`): no count here.
 */
export function chatRing(
  track: ChatNotifyTrack,
  activity: ChatActivity,
): PaneBackground {
  return {
    count: 0,
    shells: activity.shells.length,
    question:
      track.roundPending || (activity.pending > 0 && track.asks.length > 0),
  };
}
