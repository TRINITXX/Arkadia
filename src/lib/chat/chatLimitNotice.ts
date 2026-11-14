import { useSyncExternalStore } from "react";

/**
 * A chat the usage limit stopped with no other account free: the banner
 * above its input (`ChatLimitBanner`) says what happens and offers the API
 * credits. Written by the limit switch, which lives in App, read by the
 * pane, which may be unmounted meanwhile.
 */
export interface LimitNotice {
  /** « Limite atteinte sur 2 Boutique · aucun autre compte libre, reprise ici à 14:35 » */
  text: string;
  /**
   * « Continuer sur les crédits »: the chat moves to the credits; false
   * when it could not (the wait goes on).
   */
  onCredits?: () => Promise<boolean>;
}

const notices = new Map<string, LimitNotice>();
/**
 * Chats whose banner the user closed: hidden for the rest of this wait,
 * the wait itself goes on. The wait's end (a null notice) clears it.
 */
const closed = new Set<string>();
const listeners = new Set<() => void>();

export function setLimitNotice(
  chatId: string,
  notice: LimitNotice | null,
): void {
  if (notice) notices.set(chatId, notice);
  else {
    closed.delete(chatId);
    if (!notices.delete(chatId)) return;
  }
  for (const l of listeners) l();
}

/** The banner's ×: out of sight till this wait ends. */
export function closeLimitNotice(chatId: string): void {
  if (!notices.has(chatId) || closed.has(chatId)) return;
  closed.add(chatId);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The notice to show: none once the user closed it. */
export function limitNotice(chatId: string): LimitNotice | null {
  if (closed.has(chatId)) return null;
  return notices.get(chatId) ?? null;
}

export function useLimitNotice(chatId: string): LimitNotice | null {
  return useSyncExternalStore(subscribe, () => limitNotice(chatId));
}
