/**
 * Where the PC stands while the socket is down, as the web page tells it
 * (src/mobile/remote.ts): the gate (src-tauri `gate`) says whether Windows
 * answers and Arkadia runs; the relay Arkadia hands over on every connection
 * (src-tauri `remote::access`) says whether the PC is on the tailnet, and
 * wakes it.
 */

import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import {
  wakeAfterLostGate,
  type WakeProgress,
  type WakeRelay,
} from "@/mobile/wake";
import { ARKADIA_HOST } from "~/remote/config";

/**
 * `offline` = no answer at all (PC off, asleep, or no Tailscale),
 * `off` = no answer, and the relay says the PC is off the tailnet,
 * `closed` = the PC answers but Arkadia is not running,
 * `starting` = the gate was just asked to start Arkadia.
 */
export type Reach = "unknown" | "offline" | "off" | "closed" | "starting";

export interface ReachView {
  reach: Reach;
  /** A wake asked from this phone, until Arkadia connects or is opened. */
  wake: WakeProgress | null;
}

const RELAY_KEY = "arkadia-wake-relay";
const GATE_TIMEOUT_MS = 4000;
/** The relay may hang when the phone's Tailscale is down. */
const RELAY_TIMEOUT_MS = 4000;
/** `/wake` answers once the packet left, after up to 15 s of reaching the LAN relay. */
const WAKE_TIMEOUT_MS = 20_000;
const WAKE_POLL_MS = 2000;
/** Arkadia takes a few seconds to start and open its server. */
const STARTING_GRACE_MS = 30_000;

let view: ReachView = { reach: "unknown", wake: null };
const subs = new Set<() => void>();
let relay: WakeRelay | null = null;
let probing = false;
let probeRun = 0;
let wakeRun = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let startingSince = 0;

function setView(next: Partial<ReachView>) {
  view = { ...view, ...next };
  for (const cb of subs) cb();
}

/** Loads the relay saved by an earlier connection: the PC may be off now. */
export async function loadRelay() {
  try {
    const raw = await SecureStore.getItemAsync(RELAY_KEY);
    relay ??= raw ? (JSON.parse(raw) as WakeRelay) : null;
  } catch {
    // No saved relay: no wake button until the PC is seen once.
  }
}

export function saveRelay(next: WakeRelay) {
  relay = next;
  void SecureStore.setItemAsync(RELAY_KEY, JSON.stringify(next)).catch(
    () => {},
  );
}

export function hasRelay(): boolean {
  return relay !== null;
}

async function getJson(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Whether Arkadia runs, per the gate; null while Windows does not answer. */
async function gateSaysArkadia(): Promise<boolean | null> {
  try {
    const body = (await getJson(
      `https://${ARKADIA_HOST}/gate/status`,
      GATE_TIMEOUT_MS,
    )) as { arkadia: boolean };
    return body.arkadia;
  } catch {
    return null;
  }
}

/** Whether the PC is on the tailnet; null when the relay does not answer. */
async function pcOnline(r: WakeRelay): Promise<boolean | null> {
  try {
    const body = (await getJson(
      `${r.url}/status?token=${encodeURIComponent(r.token)}`,
      RELAY_TIMEOUT_MS,
    )) as { online: boolean };
    return body.online;
  } catch {
    return null;
  }
}

/** Has the relay send the wake packet (a no-op when the PC is on). */
async function sendWake(r: WakeRelay): Promise<boolean> {
  try {
    const body = (await getJson(
      `${r.url}/wake?token=${encodeURIComponent(r.token)}`,
      WAKE_TIMEOUT_MS,
    )) as { ok: boolean };
    return body.ok;
  } catch {
    return false;
  }
}

const starting = () =>
  view.reach === "starting" && Date.now() - startingSince < STARTING_GRACE_MS;

/**
 * Asks the gate why the socket is down. One at a time: with the PC off a
 * probe lasts up to gate plus relay timeouts, longer than a reconnect cycle.
 */
export async function probeGate(isOpen: () => boolean) {
  if (probing) return;
  probing = true;
  const run = ++probeRun;
  const stale = () => run !== probeRun || isOpen() || starting();
  try {
    if (stale()) return;
    const arkadia = await gateSaysArkadia();
    if (stale()) return;
    if (arkadia !== null) {
      setView({ reach: arkadia ? "unknown" : "closed" });
      return;
    }
    // No gate: the relay, elsewhere on the tailnet, tells a PC that is off
    // from a phone without Tailscale (then it does not answer either).
    const online = relay ? await pcOnline(relay) : null;
    if (stale()) return;
    const wake = wakeAfterLostGate(view.wake);
    if (wake !== view.wake) stopWake();
    // A relay that does not answer this time takes nothing back from « off ».
    const off = online === false || (online === null && view.reach === "off");
    setView({ reach: off ? "off" : "offline", wake });
  } finally {
    probing = false;
  }
}

/**
 * Asks the relay right away, alongside the socket: it answers in a moment,
 * where a PC that is off leaves the socket hanging. Only ever says « off ».
 */
export async function askRelayEarly(isOpen: () => boolean) {
  const settled = () =>
    !!view.wake || probing || view.reach === "closed" || starting();
  if (!relay || settled()) return;
  const run = probeRun;
  if ((await pcOnline(relay)) !== false) return;
  if (run === probeRun && !isOpen() && !settled()) setView({ reach: "off" });
}

/** The socket is up: whatever was known about the PC is stale. */
export function onConnected() {
  stopWake();
  probeRun++;
  setView({ reach: "unknown", wake: null });
}

/** Wakes the PC through the relay, then follows it until Windows answers. */
export async function wakePc(reconnect: () => void): Promise<void> {
  const r = relay;
  if (!r) return;
  stopWake();
  const run = wakeRun;
  setView({ wake: { done: 0, since: Date.now(), failed: false } });
  const sent = await sendWake(r);
  if (run !== wakeRun || !view.wake) return;
  setView({
    wake: sent
      ? { done: 1, since: Date.now(), failed: false }
      : { ...view.wake, failed: true },
  });
  followWake(r, run, reconnect);
}

/**
 * Advances the wake as the PC comes back: on the tailnet (the relay says),
 * then Windows (the gate answers). Keeps watching past the 30 s, and even
 * when the order failed: the PC may come up anyway.
 */
function followWake(r: WakeRelay, run: number, reconnect: () => void) {
  wakeTimer = setTimeout(async () => {
    const done = view.wake?.done ?? 3;
    if (done < 2) {
      if ((await pcOnline(r)) && run === wakeRun) advanceWake(2);
    } else if (done === 2) {
      const arkadia = await gateSaysArkadia();
      if (arkadia !== null && run === wakeRun) {
        advanceWake(3);
        setView({ reach: arkadia ? "unknown" : "closed" });
        if (arkadia) reconnect();
      }
    }
    if (run === wakeRun && view.wake && view.wake.done < 3)
      followWake(r, run, reconnect);
  }, WAKE_POLL_MS);
}

function advanceWake(done: 2 | 3) {
  if (view.wake) setView({ wake: { done, since: Date.now(), failed: false } });
}

/** Ends the wake being followed; a new one starts its own run. */
function stopWake() {
  wakeRun++;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
}

/** Has the gate start Arkadia; the socket reconnects once it is up. */
export async function openArkadia(): Promise<void> {
  stopWake();
  const since = Date.now();
  startingSince = since;
  setView({ reach: "starting", wake: null });
  try {
    // The gate takes a POST only from its own page's origin, like the socket.
    await getJson(`https://${ARKADIA_HOST}/gate/open`, GATE_TIMEOUT_MS, {
      method: "POST",
      headers: { Origin: `https://${ARKADIA_HOST}` },
    });
  } catch {
    // Only if nothing newer was learned meanwhile.
    if (view.reach === "starting" && startingSince === since)
      setView({ reach: "offline" });
  }
}

export function useReach(): ReachView {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => view,
  );
}
