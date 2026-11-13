/**
 * Claude accounts as the Rust side reports them (`accounts_state`), plus the
 * pure helpers the sidepanel, the tab bar and the toolbar share.
 *
 * Panes carry an `accountId`; a pane without one runs on the main account.
 */

import type { Tab } from "@/types";
import { stateFromTitle } from "@/lib/agentState";
import {
  CREDITS_ACCOUNT_ID,
  CREDITS_COLOR,
  CREDITS_LABEL,
} from "@/lib/creditsAccount";

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

/** The week's share one model may use (Fable), as the last poll read it. */
export interface ModelUsage extends UsageWindow {
  /** As the endpoint names it: `Fable`. */
  model: string;
}

export interface AccountUsage {
  fiveHour?: UsageWindow | null;
  sevenDay?: UsageWindow | null;
  /** Per-model weekly shares (the poll's alone, every 30 min). */
  models?: ModelUsage[];
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
 * A pane's account where only a subscription serves: a split, the terminal a
 * chat turns back into, claude.ai's sign-in for artifacts, a Chrome profile,
 * a terminal's quota. A chat on the API credits counts as the main account's
 * there (its shell runs on it). Undefined: the main account, as panes hold it.
 */
export function subscriptionAccount(
  accountId: string | undefined,
): string | undefined {
  return accountId === CREDITS_ACCOUNT_ID ? undefined : accountId;
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
    // A chat on the API credits: their mark, not the main account's.
    if (id === CREDITS_ACCOUNT_ID) {
      marks[tab.id] = { color: CREDITS_COLOR, label: CREDITS_LABEL };
      continue;
    }
    const account = byId.get(id) ?? byId.get(MAIN_ACCOUNT_ID);
    if (account) marks[tab.id] = { color: account.color, label: account.label };
  }
  return marks;
}

/**
 * Panes of a tab that "switch account" relaunches: those running Claude right
 * now (a status glyph in their title, or a chat) on another account than
 * `accountId`. Plain shells keep their account.
 */
export function claudePanesToSwitch(tab: Tab, accountId: string): string[] {
  return Object.values(tab.panes)
    .filter(
      (p) =>
        // A chat pane always runs Claude (its glyph is its own, `ChatPane`).
        (!!p.chat || stateFromTitle(p.title) !== null) &&
        paneAccountId(p.accountId) !== accountId,
    )
    .map((p) => p.id);
}

/**
 * Unix ms until which each account is known to be at its usage limit. A key
 * `<account>:<family>` (`modelBlockKey`) holds one model only: the « Fable
 * limit » of 12/11/2026 left Opus free on that account.
 */
export type BlockedUntil = Record<string, number>;

/** `1e37cada:fable`: a limit on one model family of an account. */
export function modelBlockKey(accountId: string, family: string): string {
  return `${accountId}:${family}`;
}

/** The model family of an id or alias (`claude-fable-5-2` → `fable`). */
export function modelFamily(model: string | null | undefined): string | null {
  const m = /(fable|opus|sonnet|haiku)/i.exec(model ?? "");
  return m ? m[1].toLowerCase() : null;
}

/** An account's weekly share for one model family, if the poll read one. */
export function modelUsage(
  usage: AccountUsage | null | undefined,
  family: string,
): ModelUsage | null {
  return usage?.models?.find((m) => modelFamily(m.model) === family) ?? null;
}

/**
 * Until when (ms) a limit hit keeps an account from a model family: its
 * whole-account block or that model's. A model not known (`null`): any of
 * its model blocks counts, the safe side.
 */
export function blockedFor(
  blocked: BlockedUntil,
  accountId: string,
  family: string | null,
): number {
  let until = blocked[accountId] ?? 0;
  const prefix = `${accountId}:`;
  for (const [key, at] of Object.entries(blocked)) {
    if (!key.startsWith(prefix)) continue;
    if (family === null || key === prefix + family) until = Math.max(until, at);
  }
  return until;
}

/**
 * Per account, its blocks of every model folded in: the terminal knows no
 * model, so a model's limit keeps its Claude off that account as before.
 */
export function accountBlocks(blocked: BlockedUntil): BlockedUntil {
  const out: BlockedUntil = {};
  for (const [key, at] of Object.entries(blocked)) {
    const id = key.split(":")[0];
    out[id] = Math.max(out[id] ?? 0, at);
  }
  return out;
}

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

/** Time left before a reset as "1:30" (h:mm), null once past or unknown. */
export function formatCountdown(
  resetsAt: number | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!resetsAt) return null;
  // Rounded up: "0:00" would read as reset already.
  const min = Math.ceil((resetsAt * 1000 - nowMs) / 60000);
  if (min <= 0) return null;
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** Time left before a reset in words: « dans 2 h 15 », « dans 45 min ». */
export function formatIn(
  resetsAt: number | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!resetsAt) return null;
  const min = Math.floor((resetsAt * 1000 - nowMs) / 60000);
  if (resetsAt * 1000 <= nowMs) return null;
  if (min < 1) return "dans < 1 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `dans ${m} min`;
  return m === 0 ? `dans ${h} h` : `dans ${h} h ${String(m).padStart(2, "0")}`;
}

/** A weekly return in full: « dim. 15/11 à 08:00 », « demain à 08:00 ». */
export function formatReturnDate(
  resetsAt: number | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!resetsAt) return null;
  const d = new Date(resetsAt * 1000);
  const time = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (d.toDateString() === now.toDateString()) return `aujourd'hui à ${time}`;
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (d.toDateString() === tomorrow.toDateString()) return `demain à ${time}`;
  const day = d.toLocaleDateString("fr-FR", { weekday: "short" });
  const date = d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${day} ${date} à ${time}`;
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
