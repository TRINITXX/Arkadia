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

export type ClientMsg =
  | { t: "watch"; pane: string | null }
  | { t: "input"; pane: string; data: string }
  | { t: "resize"; pane: string; cols: number; rows: number }
  | { t: "scroll"; pane: string; delta: number }
  | { t: "wheel"; pane: string; col: number; row: number; button: 64 | 65 }
  | { t: "action"; id: number; action: RemoteAction }
  | { t: "sessions"; id: number }
  | { t: "search"; id: number; query: string }
  | { t: "conv"; id: number; pane: string; generation: number; have: number };

type ServerMsg =
  | { t: "state"; state: RemoteSnapshot }
  | { t: "frame"; frame: RenderPayload }
  | { t: "reply"; id: number; result?: unknown; error?: string }
  | { t: "event"; name: string; payload: unknown }
  | { t: "error"; message: string };

/** `connecting` until the first open, `lost` while retrying after a drop. */
export type Status = "connecting" | "open" | "lost";

/**
 * Where the PC stands while the socket is down, as the gate tells it:
 * `offline` = no answer at all (PC off, asleep, or no Tailscale),
 * `closed` = the PC answers but Arkadia is not running,
 * `starting` = the gate was just asked to start Arkadia.
 */
export type Reach = "unknown" | "offline" | "closed" | "starting";

export interface RemoteView {
  status: Status;
  reach: Reach;
  snapshot: RemoteSnapshot | null;
}

const RETRY_MAX_MS = 5000;
const REQUEST_TIMEOUT_MS = 20_000;
/** A content search reads the whole history: half a minute is common. */
const SEARCH_TIMEOUT_MS = 90_000;
/** Arkadia takes a few seconds to start and open its server. */
const STARTING_GRACE_MS = 30_000;

let socket: WebSocket | null = null;
let retryMs = 500;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let view: RemoteView = {
  status: "connecting",
  reach: "unknown",
  snapshot: null,
};
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

/** Asks the gate why the socket is down. */
async function probeGate() {
  if (
    view.reach === "starting" &&
    Date.now() - startingSince < STARTING_GRACE_MS
  )
    return;
  try {
    const res = await window.fetch(gateUrl("/status"), { cache: "no-store" });
    if (socket?.readyState === WebSocket.OPEN) return;
    // No gate behind Tailscale: the PC is there, its state is not known.
    if (!res.ok) return setView({ reach: "unknown" });
    const body = (await res.json()) as { arkadia: boolean };
    setView({ reach: body.arkadia ? "unknown" : "closed" });
  } catch {
    if (socket?.readyState !== WebSocket.OPEN) setView({ reach: "offline" });
  }
}

/** Has the gate start Arkadia; the socket reconnects once it is up. */
export async function openArkadia(): Promise<void> {
  startingSince = Date.now();
  setView({ reach: "starting" });
  try {
    await window.fetch(gateUrl("/open"), { method: "POST" });
  } catch {
    setView({ reach: "offline" });
  }
}

function connect() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const ws = new WebSocket(socketUrl());
  socket = ws;
  ws.onopen = () => {
    retryMs = 500;
    setView({ status: "open", reach: "unknown" });
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
    } else if (msg.t === "error") console.warn("[arkadia]", msg.message);
  };
  ws.onclose = () => {
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
