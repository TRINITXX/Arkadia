/**
 * The app's single connection to Arkadia, the same socket the web page uses
 * (src/mobile/remote.ts, src-tauri `remote`). Module store: the desktop
 * snapshot and the watched pane's frames have separate subscribers, so a
 * frame re-renders the terminal only. The last snapshot and frame stay while
 * the socket is down: coming back to the app shows them at once.
 */

import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { RemoteAction, RemoteActionResult } from "@/lib/remoteActions";
import type {
  ClientMsg,
  FileSource,
  RemoteFile,
  ServerMsg,
} from "@/lib/remoteProtocol";
import type { RemoteSnapshot } from "@/lib/remoteSnapshot";
import type { ClaudeSession, SessionMatch } from "@/lib/sessionsIndex";
import type { RenderPayload } from "@/types";
import { ARKADIA_HOST } from "~/remote/config";
import {
  askRelayEarly,
  loadRelay,
  onConnected,
  probeGate,
  saveRelay,
} from "~/remote/reach";
import { noteFrame, noteInput, noteNetwork } from "~/terminal/stats";

/** `connecting` until the first open, `lost` while retrying after a drop. */
export type Status = "connecting" | "open" | "lost";

export interface RemoteView {
  status: Status;
  snapshot: RemoteSnapshot | null;
}

/** React Native's socket takes headers as a third argument; the DOM typings
 *  the project also loads do not know it. */
type NativeWebSocket = new (
  url: string,
  protocols: string[] | null,
  options: { headers: Record<string, string> },
) => WebSocket;

const RETRY_MAX_MS = 5000;
const REQUEST_TIMEOUT_MS = 20_000;
/** A content search reads the whole history: half a minute is common. */
const SEARCH_TIMEOUT_MS = 90_000;
/** A PC that is off leaves connections hanging instead of refusing them. */
const CONNECT_TIMEOUT_MS = 5000;
const NETWORK_PROBE_EVERY_MS = 5000;
const PROBE_TIMEOUT_MS = 4000;
/** Away from the app longer than this, the socket is not trusted any more. */
const STALE_AFTER_MS = 20_000;

let socket: WebSocket | null = null;
let retryMs = 500;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let view: RemoteView = { status: "connecting", snapshot: null };
let watched: string | null = null;
let frame: RenderPayload | null = null;
let frameReceivedAt = 0;
let started = false;
let openedBefore = false;
/** In front: the PC counts the watched pane as on screen (no push for it). */
let inFront = true;
let pushToken: string | null = null;
/** Undefined until the app knows whether it runs a Live Activity. */
let activityToken: string | null | undefined;
/** Null until the PC said which panes the iPhone drives. */
let followed: string[] | null = null;
const followSubs = new Set<() => void>();
let probing = false;
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

function setFrame(next: RenderPayload | null, receivedAt = 0) {
  frame = next;
  frameReceivedAt = receivedAt;
  for (const cb of frameSubs) cb();
}

const isOpen = () => socket?.readyState === WebSocket.OPEN;

function connect() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (!ARKADIA_HOST) return;
  // The server takes a socket only from its own page's origin: the app
  // presents it, the tailnet check still decides who gets in.
  const ws = new (WebSocket as NativeWebSocket)(
    `wss://${ARKADIA_HOST}/ws`,
    null,
    {
      headers: { origin: `https://${ARKADIA_HOST}` },
    },
  );
  socket = ws;
  void askRelayEarly(isOpen);
  // Not left to `onclose`: a socket closed while connecting may never fire it.
  const giveUp = setTimeout(() => {
    if (ws.readyState !== WebSocket.CONNECTING) return;
    ws.close();
    drop(ws);
  }, CONNECT_TIMEOUT_MS);
  ws.onopen = () => {
    clearTimeout(giveUp);
    retryMs = 500;
    onConnected();
    setView({ status: "open" });
    if (watched && inFront) send({ t: "watch", pane: watched });
    if (pushToken) send({ t: "push", token: pushToken });
    if (activityToken !== undefined)
      send({ t: "activity", token: activityToken });
    // Back after a drop: what changed meanwhile announced itself while we
    // were away. A bare event makes every open message view read again.
    if (openedBefore) emit("agent-state-changed", {});
    openedBefore = true;
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMsg;
    if (msg.t === "state") setView({ snapshot: msg.state });
    else if (msg.t === "frame" && msg.frame.session_id === watched) {
      const now = performance.now();
      noteFrame(now);
      setFrame(msg.frame, now);
    } else if (msg.t === "reply") {
      const waiting = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error !== undefined) waiting?.reject(new Error(msg.error));
      else waiting?.resolve(msg.result);
    } else if (msg.t === "event") emit(msg.name, msg.payload);
    else if (msg.t === "wake") saveRelay({ url: msg.url, token: msg.token });
    else if (msg.t === "follow") {
      followed = msg.panes;
      for (const cb of followSubs) cb();
    } else if (msg.t === "error") console.warn("[arkadia]", msg.message);
  };
  ws.onclose = () => {
    clearTimeout(giveUp);
    drop(ws);
  };
}

/** Forgets `ws` and schedules the next attempt; once per socket. */
function drop(ws: WebSocket) {
  if (socket !== ws) return;
  socket = null;
  for (const p of pending.values()) p.reject(new Error("connexion perdue"));
  pending.clear();
  if (view.status === "open") setView({ status: "lost" });
  void probeGate(isOpen);
  retryTimer = setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}

/** Starts over at once instead of waiting for the next attempt. */
export function reconnectNow() {
  retryMs = 500;
  const stale = socket;
  if (stale) {
    stale.close();
    drop(stale);
  }
  connect();
}

/** A bare HTTP round trip to the PC: the network's share of the echo. */
async function probeNetwork() {
  if (view.status !== "open" || probing) return;
  probing = true;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(
      `https://${ARKADIA_HOST}/mobile/icon-180.png?probe=${Date.now()}`,
      { method: "HEAD", cache: "no-store", signal: abort.signal },
    );
    if (res.ok) noteNetwork(performance.now() - start);
  } catch {
    // Down or slow: the socket's own status says so.
  } finally {
    clearTimeout(timer);
    probing = false;
  }
}

/** Opens the connection and keeps it up (iOS drops it in the background). */
export function startRemote() {
  if (started) return;
  started = true;
  void loadRelay();
  connect();
  let leftAt = 0;
  AppState.addEventListener("change", (state) => {
    if (state !== "active") {
      leftAt ||= Date.now();
      // Out of sight: the PC may ring the phone for the pane it showed.
      if (state === "background" && inFront) {
        inFront = false;
        send({ t: "watch", pane: null });
      }
      return;
    }
    const away = leftAt ? Date.now() - leftAt : 0;
    leftAt = 0;
    if (!inFront) {
      inFront = true;
      if (watched) send({ t: "watch", pane: watched });
    }
    // After a while in the background, iOS may have cut a socket that still
    // reads as open: start over rather than show a frozen terminal.
    if (!socket || away > STALE_AFTER_MS) reconnectNow();
  });
  setInterval(() => void probeNetwork(), NETWORK_PROBE_EVERY_MS);
}

export function hostConfigured(): boolean {
  return ARKADIA_HOST !== "";
}

/** False when the connection is down: the message is dropped, not queued. */
export function send(msg: ClientMsg): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  if (msg.t === "input") noteInput();
  return true;
}

function request<T>(
  build: (id: number) => ClientMsg,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextRequestId++;
    if (!send(build(id))) {
      reject(new Error("Arkadia injoignable"));
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("pas de réponse d’Arkadia"));
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

/** Runs an action on the desktop (new tab, button, close…). */
export async function act(action: RemoteAction): Promise<RemoteActionResult> {
  const result = await request<RemoteActionResult>((id) => ({
    t: "action",
    id,
    action,
  }));
  if (result.error) throw new Error(result.error);
  return result;
}

/** The PC's recent photos or downloads, newest first. */
export function listFiles(
  source: FileSource,
  limit: number,
): Promise<RemoteFile[]> {
  return request((id) => ({ t: "files", id, source, limit }));
}

/** The last code block Claude wrote in the pane; null when there is none. */
export function readCodeBlock(paneId: string): Promise<string | null> {
  return request((id) => ({ t: "code", id, pane: paneId }));
}

/** Hands the app's push token to the PC, now and on every reconnection. */
export function registerPushToken(token: string) {
  pushToken = token;
  send({ t: "push", token });
}

/** Hands the PC the Live Activity's token (null: ended), now and later. */
export function registerActivityToken(token: string | null) {
  activityToken = token;
  send({ t: "activity", token });
}

/** The panes the iPhone drives, as the PC tells; null until it did. */
export function useFollowedPanes(): string[] | null {
  return useSyncExternalStore(
    (cb) => {
      followSubs.add(cb);
      return () => followSubs.delete(cb);
    },
    () => followed,
  );
}

export function listSessions(): Promise<ClaudeSession[]> {
  return request((id) => ({ t: "sessions", id }));
}

export function searchSessions(query: string): Promise<SessionMatch[]> {
  return request((id) => ({ t: "search", id, query }), SEARCH_TIMEOUT_MS);
}

/** The pane's conversation since block `have` (see src-tauri `conversation`). */
export function readConversation<T>(
  paneId: string,
  generation: number,
  have: number,
): Promise<T> {
  return request((id) => ({ t: "conv", id, pane: paneId, generation, have }));
}

/** Desktop events relayed to the phones (`agent-state-changed`). */
const eventSubs = new Map<string, Set<(payload: unknown) => void>>();

function emit(name: string, payload: unknown) {
  for (const handler of eventSubs.get(name) ?? []) handler(payload);
}

/** Calls `handler` on each `name` event; returns the unsubscribe. */
export function onEvent(
  name: string,
  handler: (payload: unknown) => void,
): () => void {
  let subs = eventSubs.get(name);
  if (!subs) eventSubs.set(name, (subs = new Set()));
  subs.add(handler);
  return () => {
    eventSubs.get(name)?.delete(handler);
  };
}

/** Writes spaced on the PC itself (the network may bunch spaced sends). */
export function sendInputs(paneId: string, parts: string[], gapMs: number) {
  const sent = send({ t: "inputs", pane: paneId, parts, gap_ms: gapMs });
  if (sent) noteInput();
  return sent;
}

function setWatched(paneId: string | null) {
  if (paneId === watched) return;
  watched = paneId;
  setFrame(null);
  if (inFront) send({ t: "watch", pane: paneId });
}

/** Every terminal screen in the stack, the topmost last. */
const watchers: { pane: string }[] = [];

/**
 * Streams `paneId`'s frames while the screen holding it is the topmost one
 * (one pane at a time); the returned release hands the stream back to the
 * screen below, which a stacked terminal screen would otherwise leave blank.
 */
export function acquireWatch(paneId: string | null): () => void {
  if (!paneId) return () => {};
  const entry = { pane: paneId };
  watchers.push(entry);
  setWatched(paneId);
  return () => {
    const i = watchers.indexOf(entry);
    if (i >= 0) watchers.splice(i, 1);
    setWatched(watchers[watchers.length - 1]?.pane ?? null);
  };
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

/** The latest frame of `paneId`, read outside rendering (taps, keys). */
export function latestFrame(paneId: string | null): RenderPayload | null {
  return frame && frame.session_id === paneId ? frame : null;
}

/** When the frame on screen arrived, for the display measure. */
export function watchedFrameReceivedAt(): number {
  return frameReceivedAt;
}
