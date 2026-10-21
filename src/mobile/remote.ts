/**
 * The phone's single connection to Arkadia (see src-tauri `remote`). Module
 * store like `frameStore`: the desktop snapshot and the watched pane's frames
 * have separate subscribers, so a frame re-renders the terminal only.
 *
 * While the socket is down, the gate (src-tauri `gate`) tells whether the PC
 * answers at all and whether Arkadia runs, and can start it.
 */

import { useSyncExternalStore } from "react";
import { TransientError, type Bridge } from "@/lib/bridge";
import type { RemoteAction, RemoteActionResult } from "@/lib/remoteActions";
import type { RemoteSnapshot } from "@/lib/remoteSnapshot";
import type { ClaudeSession, SessionMatch } from "@/lib/sessionsIndex";
import type { RenderPayload } from "@/types";
import {
  loadRelay,
  pcOnline,
  saveRelay,
  sendWake,
  wakeAfterLostGate,
  type WakeProgress,
  type WakeRelay,
} from "@/mobile/wake";

export type ClientMsg =
  | { t: "watch"; pane: string | null }
  | { t: "input"; pane: string; data: string }
  | { t: "resize"; pane: string; cols: number; rows: number }
  | { t: "scroll"; pane: string; delta: number }
  | { t: "wheel"; pane: string; col: number; row: number; button: 64 | 65 }
  | { t: "click"; pane: string; col: number; row: number }
  | { t: "action"; id: number; action: RemoteAction }
  | { t: "sessions"; id: number }
  | { t: "search"; id: number; query: string }
  | { t: "conv"; id: number; pane: string; generation: number; have: number };

type ServerMsg =
  | { t: "state"; state: RemoteSnapshot }
  | { t: "frame"; frame: RenderPayload }
  | { t: "reply"; id: number; result?: unknown; error?: string }
  | { t: "event"; name: string; payload: unknown }
  | ({ t: "wake" } & WakeRelay)
  | { t: "error"; message: string };

/** `connecting` until the first open, `lost` while retrying after a drop. */
export type Status = "connecting" | "open" | "lost";

/**
 * Where the PC stands while the socket is down, as the gate tells it:
 * `offline` = no answer at all (PC off, asleep, or no Tailscale),
 * `off` = no answer, and the wake relay says the PC is off the tailnet,
 * `closed` = the PC answers but Arkadia is not running,
 * `starting` = the gate was just asked to start Arkadia.
 */
export type Reach = "unknown" | "offline" | "off" | "closed" | "starting";

export interface RemoteView {
  status: Status;
  reach: Reach;
  snapshot: RemoteSnapshot | null;
  /** A wake asked from this phone, until Arkadia connects or is opened. */
  wake: WakeProgress | null;
}

const RETRY_MAX_MS = 5000;
const REQUEST_TIMEOUT_MS = 20_000;
/** A content search reads the whole history: half a minute is common. */
const SEARCH_TIMEOUT_MS = 90_000;
/** Arkadia takes a few seconds to start and open its server. */
const STARTING_GRACE_MS = 30_000;
/** How often a wake asks the relay, then the gate, how far the PC got. */
const WAKE_POLL_MS = 2000;
/**
 * A PC that is off leaves connections hanging instead of refusing them: past
 * these, the socket gives up and the gate counts as silent.
 */
const CONNECT_TIMEOUT_MS = 5000;
const GATE_TIMEOUT_MS = 4000;

let socket: WebSocket | null = null;
let retryMs = 500;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let view: RemoteView = {
  status: "connecting",
  reach: "unknown",
  snapshot: null,
  wake: null,
};
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let wakeRun = 0;
let probeRun = 0;
let probing = false;
let watched: string | null = null;
let frame: RenderPayload | null = null;
let startingSince = 0;
let openedBefore = false;
const viewSubs = new Set<() => void>();
const frameSubs = new Set<() => void>();

let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (e: Error) => void }
>();

function setView(next: Partial<RemoteView>) {
  view = { ...view, ...next };
  for (const cb of viewSubs) cb();
}

function setFrame(next: RenderPayload | null) {
  frame = next;
  for (const cb of frameSubs) cb();
}

/** A dev override from the page URL (`?ws=host:port`, `?gate=host:port`). */
function override(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function socketUrl(): string {
  const host = override("ws");
  if (host) return `ws://${host}/ws`;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws`;
}

function gateUrl(path: string): string {
  const host = override("gate");
  return host ? `http://${host}${path}` : `/gate${path}`;
}

/**
 * Asks the gate why the socket is down. One at a time: with the PC off a
 * probe lasts up to gate plus relay timeouts, longer than a reconnect cycle,
 * and each newer probe would make the last one stale before it answered.
 */
async function probeGate() {
  if (probing) return;
  probing = true;
  try {
    await probeGateOnce();
  } finally {
    probing = false;
  }
}

async function probeGateOnce() {
  const run = ++probeRun;
  // A newer probe, an open socket or Arkadia starting: this one is stale.
  const stale = () =>
    run !== probeRun ||
    socket?.readyState === WebSocket.OPEN ||
    (view.reach === "starting" &&
      Date.now() - startingSince < STARTING_GRACE_MS);
  if (stale()) return;
  try {
    const res = await window.fetch(gateUrl("/status"), {
      cache: "no-store",
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
    });
    if (stale()) return;
    // No gate behind Tailscale: the PC is there, its state is not known.
    if (!res.ok) return setView({ reach: "unknown" });
    const body = (await res.json()) as { arkadia: boolean };
    if (stale()) return;
    setView({ reach: body.arkadia ? "unknown" : "closed" });
  } catch {
    // No gate: the relay, elsewhere on the tailnet, tells a PC that is off
    // from a phone without Tailscale (then it does not answer either).
    const relay = loadRelay();
    const online = relay ? await pcOnline(relay) : null;
    if (stale()) return;
    const wake = wakeAfterLostGate(view.wake);
    if (wake !== view.wake) stopWake();
    // A relay that does not answer this time takes nothing back from « off ».
    const off = online === false || (online === null && view.reach === "off");
    setView({ reach: off ? "off" : "offline", wake });
  }
}

/**
 * Asks the relay right away, alongside the socket: it answers in a moment,
 * where a PC that is off leaves the socket hanging for CONNECT_TIMEOUT_MS.
 * Only ever says « off »; the socket opening still wins.
 */
async function askRelayEarly() {
  const relay = loadRelay();
  // A probe under way asks the relay itself; a gate that answered (« closed »)
  // knows better than a relay still catching up with Tailscale.
  const settled = () =>
    !!view.wake ||
    probing ||
    view.reach === "closed" ||
    (view.reach === "starting" &&
      Date.now() - startingSince < STARTING_GRACE_MS);
  if (!relay || settled()) return;
  const run = probeRun;
  if ((await pcOnline(relay)) !== false) return;
  if (run === probeRun && socket?.readyState !== WebSocket.OPEN && !settled())
    setView({ reach: "off" });
}

/** Wakes the PC through the relay, then follows it until Windows answers. */
export async function wakePc(): Promise<void> {
  const relay = loadRelay();
  if (!relay) return;
  stopWake();
  const run = wakeRun;
  setView({ wake: { done: 0, since: Date.now(), failed: false } });
  const sent = await sendWake(relay);
  if (run !== wakeRun || !view.wake) return;
  setView({
    wake: sent
      ? { done: 1, since: Date.now(), failed: false }
      : { ...view.wake, failed: true },
  });
  followWake(relay, run);
}

/**
 * Advances the wake as the PC comes back: on the tailnet (the relay says),
 * then Windows (the gate answers). Keeps watching past the 30 s, and even
 * when the order failed: the PC may come up anyway.
 */
function followWake(relay: WakeRelay, run: number) {
  wakeTimer = setTimeout(async () => {
    const done = view.wake?.done ?? 3;
    if (done < 2) {
      if ((await pcOnline(relay)) && run === wakeRun) advanceWake(2);
    } else if (done === 2) {
      const arkadia = await gateSaysArkadia();
      if (arkadia !== null && run === wakeRun) {
        advanceWake(3);
        setView({ reach: arkadia ? "unknown" : "closed" });
        if (arkadia) reconnectNow();
      }
    }
    if (run === wakeRun && view.wake && view.wake.done < 3)
      followWake(relay, run);
  }, WAKE_POLL_MS);
}

/** Whether Arkadia runs, per the gate; null while Windows is not up. */
async function gateSaysArkadia(): Promise<boolean | null> {
  try {
    const res = await window.fetch(gateUrl("/status"), {
      cache: "no-store",
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { arkadia: boolean }).arkadia;
  } catch {
    return null;
  }
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
    await window.fetch(gateUrl("/open"), {
      method: "POST",
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
    });
  } catch {
    // Only if nothing newer was learned meanwhile.
    if (view.reach === "starting" && startingSince === since)
      setView({ reach: "offline" });
  }
}

function connect() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const ws = new WebSocket(socketUrl());
  socket = ws;
  // Closing a socket still connecting fires `onclose`, which asks the gate.
  const giveUp = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) ws.close();
  }, CONNECT_TIMEOUT_MS);
  void askRelayEarly();
  ws.onopen = () => {
    clearTimeout(giveUp);
    retryMs = 500;
    stopWake();
    setView({ status: "open", reach: "unknown", wake: null });
    if (watched) send({ t: "watch", pane: watched });
    // Back after a drop: what changed meanwhile announced itself while we
    // were away. A bare event makes every open modern view read again.
    if (openedBefore)
      for (const handler of eventSubs.get("agent-state-changed") ?? [])
        handler({});
    openedBefore = true;
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMsg;
    if (msg.t === "state") setView({ snapshot: msg.state });
    else if (msg.t === "frame" && msg.frame.session_id === watched)
      setFrame(msg.frame);
    else if (msg.t === "reply") {
      const waiting = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error !== undefined) waiting?.reject(new Error(msg.error));
      else waiting?.resolve(msg.result);
    } else if (msg.t === "event") {
      for (const handler of eventSubs.get(msg.name) ?? []) handler(msg.payload);
    } else if (msg.t === "wake") saveRelay({ url: msg.url, token: msg.token });
    else if (msg.t === "error") console.warn("[arkadia]", msg.message);
  };
  ws.onclose = () => {
    clearTimeout(giveUp);
    if (socket !== ws) return;
    socket = null;
    for (const p of pending.values())
      p.reject(new TransientError("connexion perdue"));
    pending.clear();
    if (view.status === "open") setView({ status: "lost" });
    void probeGate();
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  };
}

/** Opens the connection and keeps it up (iOS drops it in the background). */
export function startRemote() {
  connect();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !socket) connect();
  });
}

/** Retries right away instead of waiting for the next attempt. */
export function reconnectNow() {
  retryMs = 500;
  if (!socket) connect();
}

/** False when the connection is down: the message is dropped, not queued. */
export function send(msg: ClientMsg): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

function request<T>(
  build: (id: number) => ClientMsg,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextRequestId++;
    if (!send(build(id))) {
      reject(new TransientError("Arkadia injoignable"));
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new TransientError("pas de réponse d’Arkadia"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
}

/** Runs an action on the desktop (new tab, button, account…). */
export async function act(action: RemoteAction): Promise<RemoteActionResult> {
  const result = await request<RemoteActionResult>((id) => ({
    t: "action",
    id,
    action,
  }));
  if (result.error) throw new Error(result.error);
  return result;
}

export function listSessions(): Promise<ClaudeSession[]> {
  return request((id) => ({ t: "sessions", id }));
}

export function searchSessions(query: string): Promise<SessionMatch[]> {
  return request((id) => ({ t: "search", id, query }), SEARCH_TIMEOUT_MS);
}

/** Desktop events relayed to the phones (`agent-state-changed`). */
const eventSubs = new Map<string, Set<(payload: unknown) => void>>();

/**
 * The phone side of the bridge the modern conversation view talks through
 * (see `@/lib/bridge`): its reads go over the socket, its images over HTTP.
 */
export const phoneBridge: Bridge = {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (cmd === "read_conversation_delta")
      return request<T>((id) => ({
        t: "conv",
        id,
        pane: String(args?.paneId),
        generation: Number(args?.generation ?? 0),
        have: Number(args?.have ?? 0),
      }));
    if (cmd === "read_image_bytes")
      return window
        .fetch(`/image?path=${encodeURIComponent(String(args?.path))}`)
        .then((res) => {
          if (!res.ok) throw new Error(`image ${res.status}`);
          return res.arrayBuffer() as Promise<T>;
        });
    // Opening a file of the PC from the phone makes no sense.
    return Promise.reject(new Error("disponible sur le PC seulement"));
  },
  listen<T>(event: string, handler: (e: { payload: T }) => void) {
    const wrapped = (payload: unknown) => handler({ payload: payload as T });
    let subs = eventSubs.get(event);
    if (!subs) eventSubs.set(event, (subs = new Set()));
    subs.add(wrapped);
    return Promise.resolve(() => {
      eventSubs.get(event)?.delete(wrapped);
    });
  },
  openUrl(url: string) {
    if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
    return Promise.resolve();
  },
};

/** Streams `paneId`'s frames (one pane at a time); null stops. */
export function watchPane(paneId: string | null) {
  if (paneId === watched) return;
  watched = paneId;
  setFrame(null);
  send({ t: "watch", pane: paneId });
}

export function useRemoteView(): RemoteView {
  return useSyncExternalStore(
    (cb) => {
      viewSubs.add(cb);
      return () => viewSubs.delete(cb);
    },
    () => view,
  );
}

export function useWatchedFrame(): RenderPayload | null {
  return useSyncExternalStore(
    (cb) => {
      frameSubs.add(cb);
      return () => frameSubs.delete(cb);
    },
    () => frame,
  );
}
