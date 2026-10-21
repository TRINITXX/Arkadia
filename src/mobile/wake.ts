/**
 * Waking the PC from the phone while it is off, through the relay Arkadia
 * hands over whenever the phone connects (src-tauri `remote::access`): the
 * PC being off, Arkadia cannot tell it then. The relay sits on another
 * machine of the tailnet, which sends the Wake-on-LAN packet at home.
 */

export interface WakeRelay {
  url: string;
  token: string;
}

/**
 * A wake in progress. `done` counts the steps behind it: 1 the order went
 * out, 2 the PC is back on the network, 3 Windows answers (the gate).
 */
export interface WakeProgress {
  done: 0 | 1 | 2 | 3;
  /** When the pending step began. */
  since: number;
  /** The relay refused or could not send the order. */
  failed: boolean;
}

/** The time a step gets before the screen says the PC does not answer. */
export const STEP_LATE_MS = 30_000;
const STORAGE_KEY = "arkadia-wake-relay";
/** The relay may hang when the phone's Tailscale is down. */
const STATUS_TIMEOUT_MS = 4000;
/** `/wake` answers once the packet left, after up to 15 s of reaching the LAN relay. */
const WAKE_TIMEOUT_MS = 20_000;

/** The pending step took too long (or the order never left): still watched. */
export function isLate(wake: WakeProgress, now: number): boolean {
  return wake.failed || (wake.done < 3 && now - wake.since > STEP_LATE_MS);
}

/**
 * The wake once the gate stopped answering: a PC that came up went away
 * since, so a finished wake gives way; one under way goes on.
 */
export function wakeAfterLostGate(
  wake: WakeProgress | null,
): WakeProgress | null {
  return wake?.done === 3 ? null : wake;
}

export function saveRelay(relay: WakeRelay) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(relay));
  } catch {
    // Private mode: no wake button, the rest works.
  }
}

export function loadRelay(): WakeRelay | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WakeRelay) : null;
  } catch {
    return null;
  }
}

async function ask(
  relay: WakeRelay,
  path: string,
  timeoutMs: number,
): Promise<unknown> {
  const url = `${relay.url}${path}?token=${encodeURIComponent(relay.token)}`;
  const res = await window.fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`relay ${res.status}`);
  return res.json();
}

/** Whether the PC is on the tailnet; null when the relay does not answer. */
export async function pcOnline(relay: WakeRelay): Promise<boolean | null> {
  try {
    const body = (await ask(relay, "/status", STATUS_TIMEOUT_MS)) as {
      online: boolean;
    };
    return body.online;
  } catch {
    return null;
  }
}

/** Has the relay send the wake packet (a no-op when the PC is on). */
export async function sendWake(relay: WakeRelay): Promise<boolean> {
  try {
    const body = (await ask(relay, "/wake", WAKE_TIMEOUT_MS)) as {
      ok: boolean;
    };
    return body.ok;
  } catch {
    return false;
  }
}
