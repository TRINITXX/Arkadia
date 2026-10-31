import { useCallback, useSyncExternalStore } from "react";
import type { RoundAnswer } from "@/lib/chat/chatQuestionRound";

/**
 * The question sheet's answers per pane, outside React like the drafts: a
 * pane unmounts with its project, and a dictation into a field may land
 * meanwhile. They belong to one reply: a new round starts empty.
 */

export interface SheetAnswers {
  replyId: string;
  answers: Record<string, RoundAnswer>;
  /** Closed by the user: not shown again for this reply. */
  closed: boolean;
}

const sheets = new Map<string, SheetAnswers>();
/** No round asked: nothing kept. */
const NO_SHEET: SheetAnswers = { replyId: "", answers: {}, closed: true };
const listeners = new Map<string, Set<() => void>>();

const EMPTY = (replyId: string): SheetAnswers => ({
  replyId,
  answers: {},
  closed: false,
});

function read(paneId: string, replyId: string): SheetAnswers {
  const sheet = sheets.get(paneId);
  return sheet?.replyId === replyId ? sheet : EMPTY(replyId);
}

export function updateSheet(
  paneId: string,
  replyId: string,
  update: (sheet: SheetAnswers) => SheetAnswers,
): void {
  sheets.set(paneId, update(read(paneId, replyId)));
  for (const cb of listeners.get(paneId) ?? []) cb();
}

/** Dictated words, after what the question's field holds. */
export function appendSheetText(
  paneId: string,
  replyId: string,
  questionId: string,
  text: string,
): void {
  updateSheet(paneId, replyId, (s) => {
    const prev = s.answers[questionId]?.text?.trimEnd() ?? "";
    return {
      ...s,
      answers: {
        ...s.answers,
        [questionId]: {
          ...s.answers[questionId],
          text: prev ? `${prev} ${text}` : text,
        },
      },
    };
  });
}

/** A pane that closes takes its sheet along. */
export function dropSheet(paneId: string): void {
  sheets.delete(paneId);
}

export function useSheetAnswers(paneId: string, replyId: string): SheetAnswers {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(paneId);
      if (!set) {
        set = new Set();
        listeners.set(paneId, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0) listeners.delete(paneId);
      };
    },
    [paneId],
  );
  // The same object while nothing changes: `read` builds a new empty one.
  const snapshot = () => {
    if (!replyId) return NO_SHEET;
    const sheet = sheets.get(paneId);
    if (sheet?.replyId === replyId) return sheet;
    const empty = EMPTY(replyId);
    sheets.set(paneId, empty);
    return empty;
  };
  return useSyncExternalStore(subscribe, snapshot);
}
