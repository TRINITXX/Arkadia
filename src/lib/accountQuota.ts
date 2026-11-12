import { useSyncExternalStore } from "react";
import {
  blockedFor,
  modelUsage,
  paneAccountId,
  type Account,
  type BlockedUntil,
} from "@/lib/accounts";

/**
 * The accounts' quotas as a chat's footer reads them: App publishes each
 * refresh of the accounts and each limit change, a footer picks its own
 * account's model share (`useModelQuota`). Out of React's props: the chat
 * view sits many levels below App.
 */

let accounts: readonly Account[] = [];
let blocked: BlockedUntil = {};
const listeners = new Set<() => void>();

export function publishAccountQuota(
  next: readonly Account[],
  nextBlocked: BlockedUntil,
): void {
  accounts = next;
  blocked = nextBlocked;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** One model's weekly share on an account, and a limit hit holding it. */
export interface ModelQuota {
  /** As the endpoint names it: « Fable ». */
  model: string;
  /** Null: no poll read it yet, only a refusal said it out. */
  pct: number | null;
  /** Unix seconds. */
  resetsAt: number | null;
  /** Unix ms: a refusal keeps the model out till then (maybe past). */
  blockedUntil: number | null;
}

/** The latest answer per account and family: the same object while unchanged. */
const cache = new Map<string, { key: string; value: ModelQuota | null }>();

export function modelQuota(
  accountId: string | undefined,
  family: string,
): ModelQuota | null {
  const id = paneAccountId(accountId);
  const account = accounts.find((a) => a.id === id);
  const share = modelUsage(account?.usage, family);
  // That model's own block: the whole account's is the 5-hour or weekly
  // figure's. Past ones go at the next save; the reader checks the time.
  const until = blockedFor(blocked, id, family);
  const own = until > (blocked[id] ?? 0) ? until : null;
  const value: ModelQuota | null =
    share || own
      ? {
          model:
            share?.model ?? family.charAt(0).toUpperCase() + family.slice(1),
          pct: share?.pct ?? null,
          resetsAt: share?.resetsAt ?? null,
          blockedUntil: own,
        }
      : null;
  const key = JSON.stringify(value);
  const slot = `${id}:${family}`;
  const kept = cache.get(slot);
  if (kept && kept.key === key) return kept.value;
  cache.set(slot, { key, value });
  return value;
}

/**
 * A model's share for a chat's account (Fable): re-renders only when it
 * changes, the poll's figure every 30 min at most.
 */
export function useModelQuota(
  accountId: string | undefined,
  family = "fable",
): ModelQuota | null {
  return useSyncExternalStore(subscribe, () => modelQuota(accountId, family));
}

/** An account's name (« 3 alexis@vtc »), for a chat's quota card. */
export function useAccountLabel(accountId: string | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => accounts.find((a) => a.id === paneAccountId(accountId))?.label ?? null,
  );
}
