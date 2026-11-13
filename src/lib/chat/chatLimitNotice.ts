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
const listeners = new Set<() => void>();

export function setLimitNotice(
  chatId: string,
  notice: LimitNotice | null,
): void {
  if (notice) notices.set(chatId, notice);
  else if (!notices.delete(chatId)) return;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function limitNotice(chatId: string): LimitNotice | null {
  return notices.get(chatId) ?? null;
}

export function useLimitNotice(chatId: string): LimitNotice | null {
  return useSyncExternalStore(subscribe, () => limitNotice(chatId));
}
