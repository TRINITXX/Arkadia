import {
  blockedFor,
  modelFamily,
  modelUsage,
  type Account,
  type BlockedUntil,
  type UsageWindow,
} from "@/lib/accounts";
import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * A chat stopped by the account's usage limit, and where it goes next (the
 * setting « Reprise automatique à la limite », as for the terminal).
 */

export interface ChatLimitHit {
  /** Epoch seconds, as the refusal says it. */
  resetsAt?: number;
  /**
   * The limit holds one model only, the account's others stay free: the
   * « Fable limit » of 12/11/2026 (`seven_day_overage_included`), Opus's
   * or Sonnet's weekly share.
   */
  scope?: "model";
  /** That model's family, when the refusal names it; else the chat's. */
  family?: string;
}

/** Refusals that hold one model: its family, null when not named. */
const MODEL_LIMITS: Record<string, string | null> = {
  seven_day_overage_included: null,
  seven_day_opus: "opus",
  seven_day_sonnet: "sonnet",
};

/** Whether a refusal's `rateLimitType` holds one model only. */
export function isModelLimit(type: string | undefined): boolean {
  return (
    type !== undefined &&
    Object.prototype.hasOwnProperty.call(MODEL_LIMITS, type)
  );
}

/** « You've reached your Fable limit. Switch to another model… » */
const MODEL_LIMIT_TEXT = /reached your (\w+) limit/i;

function replyText(message: JsonObject): string {
  const content = (message.message as JsonObject | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      const block = c as JsonObject;
      return block?.type === "text" && typeof block.text === "string"
        ? block.text
        : "";
    })
    .join(" ");
}

/**
 * The limit refusing a request of the chat's own turn, or null: a rejected
 * `rate_limit_event` (not while extra usage pays for it), or Claude's reply
 * replaced by the `rate_limit` error.
 */
export function chatLimitHit(message: JsonObject): ChatLimitHit | null {
  if (message.parent_tool_use_id) return null;
  if (message.type === "rate_limit_event") {
    const info = (message.rate_limit_info ?? {}) as JsonObject;
    if (info.status !== "rejected") return null;
    if (info.isUsingOverage === true || info.overageInUse === true) return null;
    const hit: ChatLimitHit =
      typeof info.resetsAt === "number" ? { resetsAt: info.resetsAt } : {};
    const type =
      typeof info.rateLimitType === "string" ? info.rateLimitType : "";
    if (isModelLimit(type)) {
      hit.scope = "model";
      const family = MODEL_LIMITS[type];
      if (family) hit.family = family;
    }
    return hit;
  }
  if (message.type === "assistant" && message.error === "rate_limit") {
    const named = modelFamily(MODEL_LIMIT_TEXT.exec(replyText(message))?.[1]);
    return named ? { scope: "model", family: named } : {};
  }
  return null;
}

/**
 * When a model limit lifts (ms). The refusal's own date is not trusted: on
 * 12/11/2026 the « Fable limit » said Sunday, and Fable came back at the
 * account's 5-hour reset. The earlier of the two, then, and never past one
 * 5-hour window (the reset not known); a share really used up shows in the
 * poll's figure (`modelUsage`), which keeps it out till its reset.
 */
export function modelLimitUntil(
  resetsAt: number | undefined,
  account: Account | undefined,
  now: number,
): number {
  const five = account?.usage?.fiveHour?.resetsAt;
  const times = [resetsAt, five]
    .filter((t): t is number => typeof t === "number" && t * 1000 > now)
    .map((t) => t * 1000 + 60_000);
  return Math.min(...times, now + 5 * 3600_000 + 60_000);
}

/**
 * The model a chat goes on with when its own is out on every account: Opus
 * for Fable, the user's pick of 12/11/2026. Any other waits for its own.
 */
export function fallbackModel(family: string | null): string | null {
  return family === "fable" ? "opus" : null;
}

/** « Opus » for a family or alias. */
export function modelName(model: string): string {
  const family = modelFamily(model) ?? model;
  return family.charAt(0).toUpperCase() + family.slice(1);
}

export type ChatLimitPlan =
  /** `model`: started on it, the chat's own being out there. */
  { kind: "switch"; accountId: string; model?: string } | { kind: "none" };

const fullUntil = (w: UsageWindow | null | undefined): number =>
  w && w.pct >= 100 && w.resetsAt ? w.resetsAt * 1000 : 0;

/**
 * When an account is free again for a model family (ms): no limit hit
 * blocks it, no window full, that model's weekly share not used up.
 */
function freeAt(
  a: Account,
  blocked: BlockedUntil,
  family: string | null,
): number {
  return Math.max(
    blockedFor(blocked, a.id, family),
    fullUntil(a.usage?.fiveHour),
    fullUntil(a.usage?.sevenDay),
    family ? fullUntil(modelUsage(a.usage, family)) : 0,
  );
}

/**
 * No account free now: when the first other signed-in one is (ms), for its
 * model or the one it falls back on, for the chat to move then rather than
 * stay stopped (the user's report of 01/11/2026: the first account came
 * back at 07:20, the chat never moved). Null: none to wait for.
 */
export function nextFreeAccountAt(
  accounts: readonly Account[],
  blocked: BlockedUntil,
  from: string,
  now: number,
  family: string | null = null,
): number | null {
  const fallback = fallbackModel(family);
  const times = accounts
    .filter((a) => a.loggedIn && a.id !== from)
    .map((a) =>
      Math.min(
        freeAt(a, blocked, family),
        fallback ? freeAt(a, blocked, fallback) : Infinity,
      ),
    )
    .filter((t) => t > now);
  return times.length > 0 ? Math.min(...times) : null;
}

/**
 * The user's rule for a chat: another signed-in account free right now for
 * its model, the one whose 5-hour window resets soonest (its quota comes
 * back anyway); an account with no reset known (window not started) comes
 * last, then the least used. Its model out everywhere (Fable's limit), an
 * account free for the next model (`fallbackModel`), its own first: Opus
 * there rather than a wait (the user's pick of 12/11/2026).
 */
export function planChatLimitSwitch(
  accounts: readonly Account[],
  blocked: BlockedUntil,
  from: string,
  now: number,
  family: string | null = null,
): ChatLimitPlan {
  const signedIn = accounts.filter((a) => a.loggedIn);
  const reset = (a: Account) => {
    const at = a.usage?.fiveHour?.resetsAt;
    return at && at * 1000 > now ? at : Infinity;
  };
  const pct = (a: Account) => a.usage?.fiveHour?.pct ?? Infinity;
  const best = (list: Account[]) =>
    list.reduce((b, a) =>
      reset(a) < reset(b) || (reset(a) === reset(b) && pct(a) < pct(b)) ? a : b,
    );
  const free = signedIn.filter(
    (a) => a.id !== from && freeAt(a, blocked, family) <= now,
  );
  if (free.length > 0) return { kind: "switch", accountId: best(free).id };
  const fallback = fallbackModel(family);
  if (!fallback) return { kind: "none" };
  const other = signedIn.filter((a) => freeAt(a, blocked, fallback) <= now);
  if (other.length === 0) return { kind: "none" };
  const here = other.find((a) => a.id === from);
  return {
    kind: "switch",
    accountId: (here ?? best(other)).id,
    model: fallback,
  };
}
