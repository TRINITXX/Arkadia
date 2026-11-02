import { invoke } from "@tauri-apps/api/core";
import type { UsageWindow } from "@/lib/accounts";
import type { ChatState, RateWindow } from "@/lib/chat/chatState";

type Limits = ChatState["limits"];

const asWindow = (w: RateWindow | undefined): UsageWindow | null =>
  w ? { pct: w.utilization * 100, resetsAt: w.resetsAt ?? null } : null;

/** A chat's rate limits in the accounts' terms; null with none known yet. */
export function usageOfLimits(
  limits: Limits,
): { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null } | null {
  const fiveHour = asWindow(limits.fiveHour);
  const sevenDay = asWindow(limits.sevenDay);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

/**
 * Tells the Comptes menu a chat's live usage of its account, as a terminal's
 * status line does (`account_report_usage`): without it, the menu only had
 * the 30-min poll, 64 % for an account at 100 % (02/11/2026). Only new
 * figures go: each event rebuilds the limits, often with the same values.
 * Rust keeps the higher figure of a window: an old or replayed one changes
 * nothing.
 */
export function reportChatUsage(
  accountId: string | undefined,
  before: Limits,
  after: Limits,
): void {
  const usage = usageOfLimits(after);
  if (!usage) return;
  if (JSON.stringify(usageOfLimits(before)) === JSON.stringify(usage)) return;
  void invoke("account_report_usage", {
    id: accountId ?? "main",
    ...usage,
  }).catch(() => {
    // Outside the app (the preview page), or an account removed since.
  });
}
