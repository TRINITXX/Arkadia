import { useCallback, useSyncExternalStore } from "react";
import {
  DRAFTS_KEY,
  parseDrafts,
  serializeDrafts,
} from "@/lib/chat/chatDraftStore";
import type { ChatImage } from "@/lib/chat/useChatSession";

/**
 * Each chat pane's unsent input, outside React: a pane unmounts when its
 * project leaves the screen (and its id changes when its account does), and
 * neither may lose a message being written, or a dictation landing meanwhile.
 */

export interface DraftImage extends ChatImage {
  id: string;
  url: string;
}

export interface ChatDraft {
  text: string;
  images: DraftImage[];
}

export const EMPTY_DRAFT: ChatDraft = { text: "", images: [] };

const drafts = new Map<string, ChatDraft>();
/** When each draft last changed: the newest keep their images on disk. */
const savedAt = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

/**
 * The webview's storage keeps the drafts across a reload or a restart
 * (`chatDraftStore`): read once at load, written a moment after a change and
 * when the page goes. Absent under the unit tests.
 */
const storage: Storage | null =
  typeof localStorage === "undefined" ? null : localStorage;
const SAVE_MS = 600;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function save(): void {
  saveTimer = undefined;
  if (!storage) return;
  const now = Date.now();
  try {
    storage.setItem(DRAFTS_KEY, serializeDrafts(drafts, savedAt, now));
  } catch {
    // Full: the text alone, the images stay in memory only.
    try {
      storage.setItem(DRAFTS_KEY, serializeDrafts(drafts, savedAt, now, false));
    } catch {
      // Nothing more to do: the drafts still live in memory.
    }
  }
}

function saveSoon(): void {
  if (!storage) return;
  saveTimer ??= setTimeout(save, SAVE_MS);
}

if (storage) {
  try {
    for (const [paneId, kept] of parseDrafts(
      storage.getItem(DRAFTS_KEY),
      Date.now(),
    )) {
      drafts.set(paneId, kept.draft);
      savedAt.set(paneId, kept.savedAt);
    }
  } catch {
    // Unreadable storage: start empty.
  }
  window.addEventListener("pagehide", () => {
    if (saveTimer === undefined) return;
    clearTimeout(saveTimer);
    save();
  });
}
/**
 * A pane relaunched under a new id: what still writes under the old one (a
 * dictation finishing, an image being read) lands in the new one.
 */
const movedTo = new Map<string, string>();

function current(paneId: string): string {
  let id = paneId;
  for (let hops = 0; movedTo.has(id) && hops < 16; hops++)
    id = movedTo.get(id)!;
  return id;
}

export function getDraft(paneId: string): ChatDraft {
  return drafts.get(paneId) ?? EMPTY_DRAFT;
}

export function setDraft(
  target: string,
  update: ChatDraft | ((prev: ChatDraft) => ChatDraft),
): void {
  const paneId = current(target);
  const next = typeof update === "function" ? update(getDraft(paneId)) : update;
  if (next === EMPTY_DRAFT || (!next.text && next.images.length === 0)) {
    drafts.delete(paneId);
    savedAt.delete(paneId);
  } else {
    drafts.set(paneId, next);
    savedAt.set(paneId, Date.now());
  }
  saveSoon();
  for (const cb of listeners.get(paneId) ?? []) cb();
}

/**
 * Where the pane's dictation under way goes instead of its draft: a field of
 * the question sheet that started it (`ChatQuestionSheet`), set once its
 * listening began. One dictation only: its text takes it, and its end
 * (text, failure or cancel: the voice back to idle), the pane's unmount or
 * the sheet's clear it, so the input's next dictation lands in the draft.
 */
const dictationTargets = new Map<string, (text: string) => void>();

export function redirectDictation(
  paneId: string,
  target: ((text: string) => void) | null,
): void {
  if (target) dictationTargets.set(current(paneId), target);
  else dictationTargets.delete(current(paneId));
}

/** A dictated text, after what the input already holds. */
export function appendDictation(paneId: string, text: string): void {
  const target = dictationTargets.get(current(paneId));
  if (target) {
    dictationTargets.delete(current(paneId));
    target(text);
    return;
  }
  setDraft(paneId, (d) => ({
    ...d,
    text: d.text.trim() ? `${d.text.trimEnd()} ${text}` : text,
  }));
}

/** A pane relaunched under a new id (account switch) keeps its input. */
export function moveDraft(fromId: string, toId: string): void {
  movedTo.set(fromId, toId);
  const draft = drafts.get(fromId);
  if (!draft) return;
  drafts.delete(fromId);
  savedAt.delete(fromId);
  setDraft(toId, draft);
}

/** A pane that closes takes its input along (pasted images weigh). */
export function dropDraft(paneId: string): void {
  drafts.delete(paneId);
  savedAt.delete(paneId);
  dictationTargets.delete(paneId);
  saveSoon();
  for (const [from, to] of movedTo) {
    if (from === paneId || to === paneId) movedTo.delete(from);
  }
}

function subscribe(paneId: string, cb: () => void): () => void {
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
}

export function usePaneDraft(
  paneId: string,
): [ChatDraft, React.Dispatch<React.SetStateAction<ChatDraft>>] {
  const draft = useSyncExternalStore(
    useCallback((cb) => subscribe(paneId, cb), [paneId]),
    () => getDraft(paneId),
  );
  const update = useCallback(
    (u: React.SetStateAction<ChatDraft>) => setDraft(paneId, u),
    [paneId],
  );
  return [draft, update];
}
