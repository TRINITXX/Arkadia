import { firstLine, firstSentence } from "@/lib/firstSentence";
import { questionsOf } from "@/lib/chat/chatQuestions";
import { lastReplyRound } from "@/lib/chat/chatQuestionRound";
import type { ChatItem, ChatState } from "@/lib/chat/chatState";

/**
 * A chat's progress line, under its tab in the sidebar's « Active » list
 * (the user's pick of 16/11/2026): « 6 min · Je relance Chrome ». In a turn,
 * the time since it started and the first sentence of Claude's latest words
 * in it (« réfléchit » before any); at rest, the time since the turn ended
 * and the first line of his last reply, often a verdict (« ✅ … »). A
 * question waiting for the user (AskUserQuestion, a ❓ round) says so, with
 * its first line. Nothing for a chat that said nothing yet.
 */
export interface ChatProgress {
  working: boolean;
  /** Epoch ms the time counts from; null when unknown (an old transcript). */
  since: number | null;
  text: string;
}

export const THINKING = "réfléchit";
export const WAITS_FOR_YOU = "Attend ta réponse";

/** Where the turn under way starts: the last turn's end, or the user's last
 *  word Claude took (one still queued is not his yet). */
const opensTurn = (item: ChatItem) =>
  item.kind === "turn" ||
  ((item.kind === "user" || item.kind === "command") &&
    !item.queued &&
    !item.dropped);

/** Claude's latest words in the turn under way. */
function turnText(items: readonly ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (opensTurn(item)) return null;
    if (item.kind === "text" && !item.error && item.text.trim())
      return item.text;
  }
  return null;
}

/** Claude's last reply, since the user's last message or command. */
function lastReply(items: readonly ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if ((item.kind === "user" || item.kind === "command") && !item.dropped)
      return null;
    if (item.kind === "text" && item.text.trim()) return item.text;
  }
  return null;
}

/** When the column last moved: the turn's end, as a rule. */
function lastAt(items: readonly ChatItem[]): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const at = items[i].at;
    if (typeof at === "number") return at;
  }
  return null;
}

const waitsFor = (question: string | undefined) => {
  const line = question ? firstLine(question) : "";
  return line ? `${WAITS_FOR_YOU} : ${line}` : WAITS_FOR_YOU;
};

/** The question waiting for the user, as the line says it; null for none. */
function pendingQuestion(state: ChatState): string | null {
  const ask = state.requests.find((r) => r.toolName === "AskUserQuestion");
  if (ask) return waitsFor(questionsOf(ask.input)[0]?.question);
  // A ❓ round waits once the turn is over (`lastReplyRound`).
  if (state.working) return null;
  const round = lastReplyRound(state.items);
  return round ? waitsFor(round.questions[0]?.title) : null;
}

export function chatProgress(state: ChatState): ChatProgress | null {
  const asked = pendingQuestion(state);
  if (state.working) {
    const said = turnText(state.items);
    return {
      working: true,
      since: state.turnStartedAt,
      text: asked ?? ((said && firstSentence(said)) || THINKING),
    };
  }
  const said = lastReply(state.items);
  const text = asked ?? (said ? firstLine(said) : "");
  return text ? { working: false, since: lastAt(state.items), text } : null;
}

export function sameProgress(
  a: ChatProgress | null,
  b: ChatProgress | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.working === b.working && a.since === b.since && a.text === b.text;
}

/** « < 1 min », « 6 min », « 1 h 20 », « 2 h ». */
export function sinceLabel(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
