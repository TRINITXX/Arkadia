import type { JsonObject } from "@/lib/chat/chatProtocol";

/**
 * The plan's quota alerts, from Claude Code's `rate_limit_event`: a window
 * past a warning threshold (« 90 % de la session utilisés »), a window used
 * up (« Limite de la session atteinte, reset à 21:00 »), extra usage billed.
 * Each alert has a key: the column says it once per threshold and window.
 */

export interface QuotaAlert {
  key: string;
  text: string;
  tone: "warning" | "error";
}

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Windows by Claude Code's names, as the alerts say them. */
const WINDOWS: Record<string, string> = {
  five_hour: "de la session",
  seven_day: "de la semaine",
  seven_day_opus: "de la semaine (Opus)",
  seven_day_sonnet: "de la semaine (Sonnet)",
};

/** Past this share of a window, an alert even without the server's warning. */
const ALERT_AT = 0.9;

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

/** Every alert a rate limit event carries, said or not yet. */
export function quotaAlerts(info: JsonObject, now: number): QuotaAlert[] {
  const unified = obj(info.unifiedWindows);
  const windows: [string, JsonObject][] = Object.entries(unified).map(
    ([type, w]) => [type, obj(w)],
  );
  const top = typeof info.rateLimitType === "string" ? info.rateLimitType : "";
  if (top && !(top in unified)) windows.push([top, info]);
  const alerts: QuotaAlert[] = [];
  for (const [type, w] of windows) {
    const name = WINDOWS[type];
    if (!name) continue;
    const resetsAt = num(w.resetsAt);
    const when =
      resetsAt === undefined ? "" : `, reset ${resetClock(resetsAt, now)}`;
    if (w.status === "rejected") {
      alerts.push({
        key: `${type}:rejected:${resetsAt ?? ""}`,
        text: `Limite ${name} atteinte${when}`,
        tone: "error",
      });
      continue;
    }
    const surpassed = num(w.surpassedThreshold);
    const threshold =
      w.status === "allowed_warning" && surpassed !== undefined
        ? surpassed
        : (num(w.utilization) ?? 0) >= ALERT_AT
          ? ALERT_AT
          : undefined;
    if (threshold === undefined || threshold <= 0) continue;
    const percent = Math.round(threshold * 100);
    alerts.push({
      key: `${type}:${percent}:${resetsAt ?? ""}`,
      text: `${percent} % ${name} utilisés${when}`,
      tone: "warning",
    });
  }
  if (info.isUsingOverage === true) {
    alerts.push({
      key: `overage:${num(info.overageResetsAt) ?? ""}`,
      text: "Usage payant activé : la suite est facturée en plus de l'abonnement",
      tone: "warning",
    });
  }
  return alerts;
}
