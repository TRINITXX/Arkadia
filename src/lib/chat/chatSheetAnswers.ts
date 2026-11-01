import { useCallback, useMemo, useSyncExternalStore } from "react";
import { lastReplyRound, type RoundAnswer } from "@/lib/chat/chatQuestionRound";
import type { ChatItem } from "@/lib/chat/chatState";

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
  /** Folded to its head (Esc): Claude's message shows its questions again. */
  folded?: boolean;
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

/**
 * A click on the chat's notification: the round its last reply asks shows
 * unfolded. A sheet the user closed (×) stays closed: he answers in the
 * input, whatever notification he clicks later. A chat not loaded yet (page
 * reloaded) keeps no sheet: its round shows unfolded anyway.
 */
export function openRoundSheet(
  paneId: string,
  items: readonly ChatItem[],
): void {
  const round = lastReplyRound(items);
  if (!round) return;
  updateSheet(paneId, round.id, (s) =>
    s.closed ? s : { ...s, folded: false },
  );
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

/**
 * The replies whose questions the sheet shows right now (it is up, open and
 * unfolded), or none: those messages drop their question blocks meanwhile
 * (`withoutQuestions`). `up`: the sheet's place is free (no turn, no
 * request, the chat open), as `ChatView` mounts it.
 */
export function useSheetReply(
  paneId: string | undefined,
  items: ChatItem[],
  up: boolean,
): readonly string[] {
  const round = useMemo(() => lastReplyRound(items), [items]);
  const sheet = useSheetAnswers(paneId ?? "", paneId ? (round?.id ?? "") : "");
  return up && round && !sheet.closed && !sheet.folded ? round.ids : NO_IDS;
}

const NO_IDS: readonly string[] = [];
