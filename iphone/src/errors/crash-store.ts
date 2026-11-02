import { useEffect, useSyncExternalStore } from "react";
import * as Updates from "expo-updates";
import { forgetLastTab } from "~/errors/opening-mark";

/**
 * The app's last error, shown instead of the app closing: a release build
 * kills itself on an uncaught JS error, and Alexis had no way to tell what
 * broke (a chat crashing at open, 02/11/2026). Its report names the update,
 * so the stack can be read against that bundle's source map.
 */
export interface Crash {
  /** Where it was caught: a screen's boundary, or the global handler. */
  where: string;
  message: string;
  stack: string;
  report: string;
  /** When it was caught (ms). */
  at: number;
}

let crash: Crash | null = null;
/** Error screens up: they show the crash, the overlay doesn't repeat it. */
let screens = 0;
const subs = new Set<() => void>();

function notify() {
  for (const cb of subs) cb();
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** The error as Alexis copies it: what, where, which update, the stack. */
export function crashOf(error: unknown, where: string): Crash {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const update = Updates.updateId ?? "embedded";
  return {
    where,
    message,
    stack,
    at: Date.now(),
    report: `Arkadia iPhone · update ${update} · ${where}\n${message}\n${stack}`,
  };
}

/** Recorded and shown; the tab under it isn't reopened at the next launch. */
export function recordCrash(error: unknown, where: string): void {
  crash = crashOf(error, where);
  if (where !== "native") forgetLastTab();
  notify();
}

export function dismissCrash(): void {
  crash = null;
  notify();
}

export function useCrash(): Crash | null {
  return useSyncExternalStore(subscribe, () => crash);
}

/** An error screen up: the overlay leaves the crash to it. */
export function useCrashScreenUp(): void {
  useEffect(() => {
    screens += 1;
    notify();
    return () => {
      screens -= 1;
      notify();
    };
  }, []);
}

export function useCrashScreensUp(): boolean {
  return useSyncExternalStore(subscribe, () => screens > 0);
}

let installed = false;

/**
 * An uncaught error outside rendering (a socket message, a timer, a module
 * failing to load) is shown, never fatal: the app stays up. Render errors
 * stop at the screens' boundaries. Two costs, known: expo-updates' recovery
 * (a crash just after launch tries another update) no longer sees these,
 * and RN's `useAlwaysAvailableJSErrorHandling` flag, if it ever turns on,
 * bypasses `ErrorUtils` and with it this handler.
 */
export function installCrashHandler(): void {
  if (installed) return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    if (!isFatal) {
      previous(error, isFatal);
      return;
    }
    recordCrash(error, "global");
  });
}
