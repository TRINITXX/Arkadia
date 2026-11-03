import {
  readHandoffBlock,
  tokensOf,
  type HandoffEvent,
  type HandoffInfo,
} from "@chat-server/handoff";
import type { ChatItem, ChatState } from "@/lib/chat/chatState";
import { compactTokens } from "@/lib/chat/chatSdkSettings";

/**
 * A handoff's separator in the column (`chat-server/handoff.ts`): running
 * while Opus writes it, done with what Claude got. Above it, the old
 * session, greyed on the desktop; the phone shows its text alone.
 */
export type NoticeHandoff =
  | { phase: "running"; before: number }
  | ({ phase: "done"; after: number } & HandoffInfo);

type NoticeItem = Extract<ChatItem, { kind: "notice" }>;

const RUNNING = "Passation en cours…";
const doneText = (after: number) =>
  `Nouvelle conversation · passation de ${compactTokens(after)}`;

/** The separator once written: the new session starts from it. */
function doneNotice(
  id: string,
  info: HandoffInfo,
  after: number,
  at: number,
): NoticeItem {
  return {
    kind: "notice",
    id,
    text: doneText(after),
    tone: "info",
    command: true,
    at,
    handoff: { phase: "done", after, ...info },
  };
}

/**
 * The server's handoff events: the separator added while Opus writes, then
 * filled in place, or turned into a warning when it failed (the old
 * session resumes as it is, nothing above it greyed any more).
 */
export function addHandoff(
  state: ChatState,
  event: HandoffEvent,
  now: number,
): ChatState {
  if (event.phase === "running") {
    const item: NoticeItem = {
      kind: "notice",
      id: event.id,
      text: RUNNING,
      tone: "info",
      command: true,
      at: now,
      handoff: { phase: "running", before: event.before },
    };
    return { ...state, items: [...state.items, item] };
  }
  const items = state.items.map((item): ChatItem => {
    if (item.id !== event.id || item.kind !== "notice") return item;
    if (event.phase === "done") {
      const { from, before, summary, after } = event;
      return doneNotice(
        item.id,
        { from, before, summary },
        after,
        item.at ?? now,
      );
    }
    return {
      kind: "notice",
      id: item.id,
      text: `Passation impossible (${event.error}) : la conversation reprend en entier`,
      tone: "warning",
      command: true,
      at: item.at,
    };
  });
  return { ...state, items };
}

/**
 * A resumed session that started from a handoff: its first message's block
 * read back as the separator (`readHandoffBlock`), or null for any other text.
 */
export function historyHandoff(
  text: string,
  id: string,
  at: number | undefined,
): NoticeItem | null {
  const info = readHandoffBlock(text);
  if (!info) return null;
  return doneNotice(`handoff:${id}`, info, tokensOf(text), at ?? 0);
}
