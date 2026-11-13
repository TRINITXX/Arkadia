import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * The Anthropic API credits as Rust reports them (`credits.rs`): whether the
 * key file is there, the Console's sign-in, and what is left. Never the key,
 * a cookie or an id. Published here so the « Comptes » card, a chat's limit
 * banner and its status bar read the same.
 */

export {
  CREDITS_ACCOUNT_ID,
  CREDITS_COLOR,
  CREDITS_LABEL,
  CREDITS_MODEL,
} from "@/lib/creditsAccount";

export type ConsoleState = "unknown" | "connected" | "disconnected";

export interface CreditTranche {
  kind: "team" | "promo" | "purchased";
  /** Cents. */
  remaining: number;
  granted: number;
  /** Unix ms. */
  expiresAt: number | null;
}

export interface CreditsState {
  keyPresent: boolean;
  console: ConsoleState;
  tranches: CreditTranche[];
  /** Cents. */
  total: number | null;
  /** Unix ms of the last successful read. */
  fetchedAt: number | null;
  /** Less than a dollar left at the last read. */
  exhausted: boolean;
}

export const NO_CREDITS: CreditsState = {
  keyPresent: false,
  console: "unknown",
  tranches: [],
  total: null,
  fetchedAt: null,
  exhausted: false,
};

let credits: CreditsState = NO_CREDITS;
const listeners = new Set<() => void>();

export function publishCredits(next: CreditsState): void {
  if (JSON.stringify(next) === JSON.stringify(credits)) return;
  credits = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function creditsNow(): CreditsState {
  return credits;
}

export function useCredits(): CreditsState {
  return useSyncExternalStore(subscribe, creditsNow);
}

/** « 457 $ » for cents. */
export function dollars(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString("fr-FR")} $`;
}

/** The Team plan's credit left (cents): the one a key pays with first. */
export function teamLeft(state: CreditsState): number | null {
  const team = state.tranches.filter((t) => t.kind === "team");
  return team.length > 0 ? team.reduce((n, t) => n + t.remaining, 0) : null;
}

/** « Team », « Promo », « Achetés » on a card's row. */
export function trancheName(kind: CreditTranche["kind"]): string {
  return kind === "team" ? "Team" : kind === "promo" ? "Promo" : "Achetés";
}

/** « 10/12 » this year, « 08/04/27 » after. */
export function expiryShort(at: number | null, now = Date.now()): string {
  if (at === null) return "";
  const d = new Date(at);
  const day = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return d.getFullYear() === new Date(now).getFullYear()
    ? day
    : `${day}/${String(d.getFullYear() % 100).padStart(2, "0")}`;
}

/** One line per credit, for a tooltip. */
export function creditsLines(state: CreditsState, now = Date.now()): string[] {
  return state.tranches.map(
    (t) =>
      `${trancheName(t.kind)} : ${dollars(t.remaining)} sur ${dollars(t.granted)}${
        t.expiresAt ? `, expire le ${expiryShort(t.expiresAt, now)}` : ""
      }`,
  );
}

/** Whether the « Comptes » menu shows the credits' card. */
export function showsCreditsCard(state: CreditsState): boolean {
  return state.keyPresent || state.console !== "unknown";
}

/** Read again now (the « Comptes » menu opens), a minute apart at most. */
export function refreshCredits(): void {
  void invoke<CreditsState>("credits_refresh")
    .then(publishCredits)
    .catch(() => {
      // Outside the app (the preview page).
    });
}

/** Opens Arkadia's window on the Console's sign-in page. */
export function openConsoleLogin(): void {
  void invoke("credits_console_login").catch(() => {});
}

/** Rust's state only (memory and a file): cheap enough to poll. */
const POLL_MS = 15_000;

/** App: keeps the published state current. */
export function useCreditsPoll(): void {
  useEffect(() => {
    let live = true;
    const read = () =>
      void invoke<CreditsState>("credits_state")
        .then((s) => live && publishCredits(s))
        .catch(() => {});
    read();
    const id = window.setInterval(read, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);
}
