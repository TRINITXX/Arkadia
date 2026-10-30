import { useCallback, useSyncExternalStore } from "react";
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
const listeners = new Map<string, Set<() => void>>();
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
  } else {
    drafts.set(paneId, next);
  }
  for (const cb of listeners.get(paneId) ?? []) cb();
}

/** A dictated text, after what the input already holds. */
export function appendDictation(paneId: string, text: string): void {
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
  setDraft(toId, draft);
}

/** A pane that closes takes its input along (pasted images weigh). */
export function dropDraft(paneId: string): void {
  drafts.delete(paneId);
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
