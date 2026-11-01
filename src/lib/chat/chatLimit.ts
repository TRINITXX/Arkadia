import type { Account, BlockedUntil, UsageWindow } from "@/lib/accounts";
import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * A chat stopped by the account's usage limit, and where it goes next (the
 * setting « Reprise automatique à la limite », as for the terminal).
 */

/**
 * The limit refusing a request of the chat's own turn, or null: a rejected
 * `rate_limit_event` (not while extra usage pays for it), or Claude's reply
 * replaced by the `rate_limit` error. `resetsAt` in epoch seconds.
 */
export function chatLimitHit(
  message: JsonObject,
): { resetsAt?: number } | null {
  if (message.parent_tool_use_id) return null;
  if (message.type === "rate_limit_event") {
    const info = (message.rate_limit_info ?? {}) as JsonObject;
    if (info.status !== "rejected") return null;
    if (info.isUsingOverage === true || info.overageInUse === true) return null;
    return typeof info.resetsAt === "number" ? { resetsAt: info.resetsAt } : {};
  }
  if (message.type === "assistant" && message.error === "rate_limit") return {};
  return null;
}

export type ChatLimitPlan =
  | { kind: "switch"; accountId: string }
  | { kind: "none" };

const fullUntil = (w: UsageWindow | null | undefined): number =>
  w && w.pct >= 100 && w.resetsAt ? w.resetsAt * 1000 : 0;

/** When an account is free again (ms): no limit hit blocks it, no window full. */
function freeAt(a: Account, blocked: BlockedUntil): number {
  return Math.max(
    blocked[a.id] ?? 0,
    fullUntil(a.usage?.fiveHour),
    fullUntil(a.usage?.sevenDay),
  );
}

/**
 * No account free now: when the first other signed-in one is (ms), for the
 * chat to move then rather than stay stopped (the user's report of
 * 01/11/2026: the first account came back at 07:20, the chat never moved).
 * Null: none to wait for.
 */
export function nextFreeAccountAt(
  accounts: readonly Account[],
  blocked: BlockedUntil,
  from: string,
  now: number,
): number | null {
  const times = accounts
    .filter((a) => a.loggedIn && a.id !== from)
    .map((a) => freeAt(a, blocked))
    .filter((t) => t > now);
  return times.length > 0 ? Math.min(...times) : null;
}

/**
 * The user's rule for a chat: another signed-in account free right now, the
 * one whose 5-hour window resets soonest (its quota comes back anyway); an
 * account with no reset known (window not started) comes last, then the
 * least used. Free: no limit hit blocks it and no window reads 100 %.
 */
export function planChatLimitSwitch(
  accounts: readonly Account[],
  blocked: BlockedUntil,
  from: string,
  now: number,
): ChatLimitPlan {
  const free = accounts.filter(
    (a) => a.loggedIn && a.id !== from && freeAt(a, blocked) <= now,
  );
  if (free.length === 0) return { kind: "none" };
  const reset = (a: Account) => {
    const at = a.usage?.fiveHour?.resetsAt;
    return at && at * 1000 > now ? at : Infinity;
  };
  const pct = (a: Account) => a.usage?.fiveHour?.pct ?? Infinity;
  const best = free.reduce((b, a) =>
    reset(a) < reset(b) || (reset(a) === reset(b) && pct(a) < pct(b)) ? a : b,
  );
  return { kind: "switch", accountId: best.id };
}
