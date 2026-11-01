import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * The plan's quota alert, from Claude Code's `rate_limit_event`: extra
 * usage billed, said once per key. And how a reset reads (« à 21:00 »).
 */

export interface QuotaAlert {
  key: string;
  text: string;
  tone: "warning" | "error";
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const DAY_MS = 86_400_000;

/** « à 21:00 », « demain à 03:00 », « lundi à 09:00 » for an epoch-seconds reset. */
export function resetClock(epochSeconds: number, now: number): string {
  const at = new Date(epochSeconds * 1000);
  const time = at.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const today = new Date(now);
  if (at.toDateString() === today.toDateString()) return `à ${time}`;
  if (at.toDateString() === new Date(now + DAY_MS).toDateString())
    return `demain à ${time}`;
  const day = at.toLocaleDateString("fr-FR", { weekday: "long" });
  return `${day} à ${time}`;
}

/**
 * The alerts a rate limit event carries: extra usage billed only. A window
 * past its threshold or used up says nothing in the column (the user's ask
 * of 01/11/2026): the rings show the share, Claude's reply the limit.
 */
export function quotaAlerts(info: JsonObject): QuotaAlert[] {
  if (info.isUsingOverage !== true) return [];
  return [
    {
      key: `overage:${num(info.overageResetsAt) ?? ""}`,
      text: "Usage payant activé : la suite est facturée en plus de l'abonnement",
      tone: "warning",
    },
  ];
}
