import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ChatState } from "@/lib/chat/chatState";
import {
  phoneAsk,
  roundSheetBorn,
  roundSheetFor,
  type BornFolded,
  withDictatedText,
  type RoundSheet,
} from "@/lib/chat/phoneAsks";

/**
 * The question sheet of each chat, outside React as the desktop keeps it
 * (`chatSheetAnswers`): answers typed, folded or closed outlive the chat's
 * screen. A new round starts empty.
 */

const sheets = new Map<string, RoundSheet>();
const listeners = new Map<string, Set<() => void>>();
/** No round asked: nothing kept, nothing shown. */
const NO_SHEET: RoundSheet = {
  replyId: "",
  answers: {},
  closed: true,
  folded: false,
};
const NO_IDS: readonly string[] = [];

export function updateRound(
  chatId: string,
  replyId: string,
  update: (sheet: RoundSheet) => RoundSheet,
): void {
  sheets.set(chatId, update(roundSheetFor(sheets.get(chatId), replyId)));
  for (const cb of listeners.get(chatId) ?? []) cb();
}

/** Chats whose next round opens folded (`foldNextRound`, `roundSheetBorn`). */
const bornFolded = new Map<string, BornFolded>();

/**
 * A message brought back to the input (the pencil, /rewind): the round the
 * rewind shows again opens folded, so the composer under it shows the
 * message (the unfolded sheet hides it). The desktop's `foldNextSheet`. The
 * round shown now keeps its sheet: it is read again before the rewind lands.
 */
export function foldNextRound(
  chatId: string,
  state: Pick<ChatState, "closed" | "requests" | "sdk" | "working" | "items">,
): void {
  const ask = phoneAsk(state);
  bornFolded.set(chatId, {
    at: Date.now(),
    except: ask?.kind === "round" ? ask.round.id : null,
  });
}

/**
 * Dictated words land in the question that started them, unless its round
 * was replaced or closed meanwhile: they never start a sheet of their own.
 */
export function dictateInto(
  chatId: string,
  replyId: string,
  key: string,
  text: string,
): void {
  const kept = sheets.get(chatId);
  if (kept?.replyId !== replyId || kept.closed) return;
  updateRound(chatId, replyId, (s) => withDictatedText(s, key, text));
}

export function useRoundSheet(chatId: string, replyId: string): RoundSheet {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(chatId);
      if (!set) {
        set = new Set();
        listeners.set(chatId, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0) listeners.delete(chatId);
      };
    },
    [chatId],
  );
  // The same object while nothing changes: a new round's sheet is kept at once.
  const snapshot = () => {
    if (!replyId) return NO_SHEET;
    const kept = sheets.get(chatId);
    if (kept?.replyId === replyId) return kept;
    // Folded when a rewind just brought it back (`foldNextRound`).
    const { sheet, consumed } = roundSheetBorn(
      kept,
      bornFolded.get(chatId),
      replyId,
      Date.now(),
    );
    if (consumed) bornFolded.delete(chatId);
    sheets.set(chatId, sheet);
    return sheet;
  };
  return useSyncExternalStore(subscribe, snapshot);
}

/**
 * The replies whose questions the sheet shows right now (up, open and
 * unfolded), else none: the desktop's `useSheetReply`. The feed drops their
 * questions meanwhile (`withoutQuestions`), and the composer hides under the
 * unfolded sheet, as the desktop's input does (`sheet-open`).
 */
export function useRoundShown(
  chatId: string,
  state: Pick<ChatState, "closed" | "requests" | "sdk" | "working" | "items">,
): readonly string[] {
  const { closed, requests, sdk, working, items } = state;
  const round = useMemo(() => {
    const ask = phoneAsk({ closed, requests, sdk, working, items });
    return ask?.kind === "round" ? ask.round : null;
  }, [closed, requests, sdk, working, items]);
  const sheet = useRoundSheet(chatId, round?.id ?? "");
  return round && !sheet.closed && !sheet.folded ? round.ids : NO_IDS;
}
