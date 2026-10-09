/**
 * Claude accounts as the Rust side reports them (`accounts_state`), plus the
 * pure helpers the sidepanel, the tab bar and the toolbar share.
 *
 * Panes carry an `accountId`; a pane without one runs on the main account.
 */

import type { Tab } from "@/types";
import { stateFromTitle } from "@/lib/agentState";

export const MAIN_ACCOUNT_ID = "main";

/** Same order as the Rust palette. No green/amber (agent states), no red. */
export const ACCOUNT_COLORS = [
  "#a78bfa",
  "#f472b6",
  "#22d3ee",
  "#818cf8",
  "#d4d4d8",
] as const;

export interface UsageWindow {
  pct: number;
  /** Unix seconds; absent once the window has reset. */
  resetsAt?: number | null;
}

export interface AccountUsage {
  fiveHour?: UsageWindow | null;
  sevenDay?: UsageWindow | null;
  /** Unix milliseconds. */
  updatedAt: number;
  source: string;
}

export interface Account {
  id: string;
  label: string;
  customLabel: boolean;
  color: string;
  email: string | null;
  plan: string | null;
  loggedIn: boolean;
  usage: AccountUsage | null;
  /** No fresh figure: the UI greys the gauges. */
  stale: boolean;
}

export interface AccountsState {
  current: string;
  max: number;
  accounts: Account[];
}

export interface AccountMark {
  color: string;
  label: string;
}

export function paneAccountId(accountId: string | undefined): string {
  return accountId ?? MAIN_ACCOUNT_ID;
}

/**
 * Account mark of each tab (its focused pane's account), or an empty map while
 * there is a single account — one account needs no marking.
 */
export function tabAccountMarks(
  tabs: Tab[],
  state: AccountsState | null,
): Record<string, AccountMark> {
  if (!state || state.accounts.length < 2) return {};
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const marks: Record<string, AccountMark> = {};
  for (const tab of tabs) {
    const id = paneAccountId(tab.panes[tab.activePaneId]?.accountId);
    const account = byId.get(id) ?? byId.get(MAIN_ACCOUNT_ID);
    if (account) marks[tab.id] = { color: account.color, label: account.label };
  }
  return marks;
}

/**
 * Panes of a tab that "switch account" relaunches: those running Claude right
 * now (a status glyph in their title) on another account than `accountId`.
 * Plain shells keep their account.
 */
export function claudePanesToSwitch(tab: Tab, accountId: string): string[] {
  return Object.values(tab.panes)
    .filter(
      (p) =>
        stateFromTitle(p.title) !== null &&
        paneAccountId(p.accountId) !== accountId,
    )
    .map((p) => p.id);
}

/** Unix ms until which each account is known to be at its usage limit. */
export type BlockedUntil = Record<string, number>;

export type AutoSwitchPlan =
  | { kind: "switch"; accountId: string }
  /** Every account is blocked: resume on `accountId` at `at` (Unix ms). */
  | { kind: "wait"; accountId: string; at: number }
  | { kind: "none" };

/**
 * Where a Claude paused on a usage limit goes next: the signed-in account with
 * the most 5-hour headroom (the weekly window does not rank). An account is
 * out while a limit hit blocks it, or while either usage figure reads 100 %
 * before its reset. A missing figure ranks last, not out. With every account
 * out, wait for the earliest one to reset.
 */
export function planAutoSwitch(
  accounts: Account[],
  blocked: BlockedUntil,
  now: number,
): AutoSwitchPlan {
  const fullUntil = (w: UsageWindow | null | undefined): number =>
    w && w.pct >= 100 && w.resetsAt ? w.resetsAt * 1000 : 0;
  const freeAt = (a: Account): number =>
    Math.max(
      blocked[a.id] ?? 0,
      fullUntil(a.usage?.fiveHour),
      fullUntil(a.usage?.sevenDay),
    );
  const signedIn = accounts.filter((a) => a.loggedIn);
  const free = signedIn.filter((a) => freeAt(a) <= now);
  if (free.length > 0) {
    const pct = (a: Account) => a.usage?.fiveHour?.pct ?? Infinity;
    const best = free.reduce((b, a) => (pct(a) < pct(b) ? a : b));
    return { kind: "switch", accountId: best.id };
  }
  if (signedIn.length === 0) return { kind: "none" };
  const first = signedIn.reduce((b, a) => (freeAt(a) < freeAt(b) ? a : b));
  return { kind: "wait", accountId: first.id, at: freeAt(first) };
}

/** "62 %" style figure, "--" when unknown. */
export function formatPct(window: UsageWindow | null | undefined): string {
  if (!window) return "--";
  return `${Math.round(window.pct)} %`;
}

/** Reset time for a tooltip: "17:20" today, "ven. 16:00" otherwise. */
export function formatReset(
  resetsAt: number | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!resetsAt) return null;
  const d = new Date(resetsAt * 1000);
  const time = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (d.toDateString() === now.toDateString()) return time;
  const day = d.toLocaleDateString("fr-FR", { weekday: "short" });
  return `${day} ${time}`;
}

/** "il y a 12 min" for the age of a usage figure. */
export function formatAge(
  updatedAt: number,
  nowMs: number = Date.now(),
): string {
  const min = Math.max(0, Math.round((nowMs - updatedAt) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return `il y a ${h} h`;
}

/** Multi-line tooltip of an account row. */
export function accountTooltip(
  account: Account,
  now: Date = new Date(),
): string {
  const lines: string[] = [account.label];
  if (account.email) lines.push(account.email);
  if (!account.loggedIn) lines.push("Non connecté : clic droit → Se connecter");
  const u = account.usage;
  if (u) {
    const five = formatReset(u.fiveHour?.resetsAt, now);
    const week = formatReset(u.sevenDay?.resetsAt, now);
    lines.push(
      `5 h : ${formatPct(u.fiveHour)}${five ? ` (reset ${five})` : ""}`,
      `Semaine : ${formatPct(u.sevenDay)}${week ? ` (reset ${week})` : ""}`,
      `Mesuré ${formatAge(u.updatedAt, now.getTime())}`,
    );
  } else {
    lines.push("Usage pas encore mesuré");
  }
  return lines.join("\n");
}
