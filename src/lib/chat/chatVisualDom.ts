import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  ACTIVATION_MS,
  frameFocusOk,
  frameGestureOk,
  mergeProbeReports,
  readFrameMessage,
  VISUAL_SHELL,
  visualDocument,
  type FrameMessage,
  type VisualReport,
} from "@/lib/chat/chatVisual";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { readVisualReport, VISUAL_FIT_HEIGHT } from "@chat-server/visualHtml";

/**
 * The visuals' frames in the page: loading one (the shell, then the page
 * posted in), the click rule for its links and choices, and the probe that
 * renders each new visual offscreen to report what breaks (REVIEW.md,
 * « Visuels du chat »).
 */

/** `visual_frame.rs`: the shell, served with the visuals' own CSP. */
const PROTOCOL = "arkvisual";

/**
 * Points a fresh frame at the shell and posts `doc` in once the shell says
 * it is up. In the app the shell comes from its protocol: a `srcdoc` would
 * inherit the app's CSP and run no script. Without Tauri (the dev preview,
 * no CSP) the shell itself is the `srcdoc`. Sandboxed `allow-scripts` only:
 * an opaque origin, no popup, no navigation of the app, no form.
 */
export function loadVisualFrame(
  iframe: HTMLIFrameElement,
  html: string,
  onMessage: (message: FrameMessage) => void,
  /** The room the card has (`--ark-fit-h`); none: the page as written. */
  fit?: number,
): { stop: () => void; setFit: (height: number) => void } {
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  visualFrames.add(iframe);
  // Only this frame's bootstrap knows it: its messages are its own.
  const token = crypto.randomUUID();
  const doc = visualDocument(html, token, fit);
  let posted = false;
  /** A room given before the page is in: sent once it is (the shell drops it). */
  let pendingFit: number | null = null;
  const sendFit = (height: number) =>
    iframe.contentWindow?.postMessage({ arkadiaVisualFit: 1, height }, "*");
  const listener = (e: MessageEvent) => {
    if (!iframe.contentWindow || e.source !== iframe.contentWindow) return;
    const message = readFrameMessage(e.data, token);
    if (!message) return;
    if (message.kind === "down") {
      pressed = { frame: iframe, at: Date.now() };
      return;
    }
    // Its window got the focus: the user's click, or its page's own doing.
    if (message.kind === "focus") {
      checkFrameFocusSoon();
      return;
    }
    if (message.kind === "shell") {
      // Once: the page could say it again to get itself reloaded.
      if (posted) return;
      posted = true;
      iframe.contentWindow.postMessage(
        { arkadiaVisualDocument: 1, html: doc },
        "*",
      );
      // After the page, in order: its bootstrap hears it.
      if (pendingFit !== null) sendFit(pendingFit);
      pendingFit = null;
      return;
    }
    onMessage(message);
  };
  window.addEventListener("message", listener);
  if (isTauri()) iframe.src = convertFileSrc("", PROTOCOL);
  else iframe.srcdoc = VISUAL_SHELL;
  return {
    stop: () => window.removeEventListener("message", listener),
    // The room the card has now (`--ark-fit-h`): its media and the page refit.
    setFit: (height) => {
      if (posted) sendFit(height);
      else pendingFit = height;
    },
  };
}

/** The Lab's own last click or key: a frame's gesture must come after. */
let lastHostInput = 0;
/** Every visual's frame (`loadVisualFrame`): the focus they take is checked. */
const visualFrames = new WeakSet<HTMLIFrameElement>();
/** What had the Lab's focus last, outside any frame: where it goes back. */
let lastHostFocus: HTMLElement | null = null;
/**
 * The visual frame the user last pressed in, and when (its bootstrap's
 * `down`, which the page can't fake). The Lab never sees the pointer inside
 * a frame of another process: neither `:hover` nor its own pointer events
 * tell which frame a click went to.
 */
let pressed: { frame: HTMLIFrameElement; at: number } | null = null;

/**
 * The focus a visual's frame holds: kept on the user's click in it, given
 * back to what had it before otherwise (a page's own `focus()`, Tab).
 */
function checkFrameFocus(): void {
  const frame = document.activeElement;
  if (!(frame instanceof HTMLIFrameElement) || !visualFrames.has(frame)) return;
  if (!document.hasFocus() || frameClickedNow(frame)) return;
  frame.blur();
  if (lastHostFocus?.isConnected) lastHostFocus.focus({ preventScroll: true });
}

if (typeof window !== "undefined") {
  const mark = () => {
    lastHostInput = Date.now();
  };
  for (const type of ["pointerdown", "pointerup", "keydown", "touchend"])
    window.addEventListener(type, mark, true);
  document.addEventListener(
    "focusin",
    (e) => {
      if (e.target instanceof HTMLElement && !(e.target instanceof HTMLIFrameElement))
        lastHostFocus = e.target;
    },
    true,
  );
  // The focus left the Lab for a frame. From one frame to another the Lab
  // hears nothing: the frame says it (`focus`, `loadVisualFrame`).
  window.addEventListener("blur", checkFrameFocusSoon);
}

/** Pressed in this frame within the gesture's life. */
const pressedIn = (iframe: HTMLIFrameElement) =>
  pressed?.frame === iframe && Date.now() - pressed.at < ACTIVATION_MS;

/** The user's click in `iframe`, now: pressed in it, a fresh gesture (`frameFocusOk`). */
function frameClickedNow(iframe: HTMLIFrameElement): boolean {
  return frameFocusOk({
    activation: navigator.userActivation?.isActive ?? false,
    onFrame: pressedIn(iframe),
  });
}

/**
 * The frame's `down` and the focus move cross processes apart: the check
 * waits a moment for the press to arrive (a page's own `focus()` keeps the
 * keyboard that long at most).
 */
const FOCUS_CHECK_MS = 150;

function checkFrameFocusSoon(): void {
  window.setTimeout(checkFrameFocus, FOCUS_CHECK_MS);
}

/** A link or choice from `iframe`, now: the user's click in it (`frameGestureOk`). */
export function frameGestureNow(iframe: HTMLIFrameElement): boolean {
  return frameGestureOk({
    activation: navigator.userActivation?.isActive ?? false,
    frameFocused: document.activeElement === iframe,
    onFrame: pressedIn(iframe),
    sinceHostInput: Date.now() - lastHostInput,
  });
}

/** A visual to check: what `visual_check` brings. */
export interface VisualCheck {
  chatId: string;
  checkId: string;
  html: string;
  wide: boolean;
}

/** The probe's frame: the column's width, or a wide pane's. */
const PROBE_WIDTH = 728;
const PROBE_WIDE = 1100;
/** Measured at two heights: a page that grows with the frame uses vh. */
const PROBE_HEIGHT = 420;
const PROBE_TALL = 900;
/** Its scripts get this long to load (CDN) before the report is asked. */
const LOAD_MS = 4_500;
/** A resized frame (another process) takes a moment to lay out again. */
const RESIZE_MS = 400;
/** The whole check, under the server's 8 s (`VISUAL_CHECK_MS`). */
const CHECK_MS = 7_000;

/** A report from the frame, or null after `ms`. */
function askReport(
  iframe: HTMLIFrameElement,
  wait: (cb: (m: FrameMessage) => void) => () => void,
  ms: number,
): Promise<VisualReport | null> {
  return new Promise((resolve) => {
    const stop = wait((m) => {
      if (m.kind !== "report") return;
      // The page answers it: only a well-formed report counts.
      done(readVisualReport(m.report));
    });
    const timer = window.setTimeout(() => done(null), ms);
    function done(r: VisualReport | null) {
      window.clearTimeout(timer);
      stop();
      resolve(r);
    }
    iframe.contentWindow?.postMessage({ arkadiaVisualProbe: 1 }, "*");
  });
}

/**
 * Renders a visual in a frame of its own, out of sight (any tab, shown or
 * not: the frame lives in the page's body, not in a pane), and resolves with
 * what it found; null when the frame said nothing.
 */
export function probeVisual(check: VisualCheck): {
  done: Promise<VisualReport | null>;
  cancel: () => void;
} {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  // Never the keyboard: its page's `focus()` can't take it from the input.
  iframe.inert = true;
  // In the viewport but invisible: an offscreen frame gets its rendering throttled.
  Object.assign(iframe.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${check.wide ? PROBE_WIDE : PROBE_WIDTH}px`,
    height: `${PROBE_HEIGHT}px`,
    border: "0",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  const listeners = new Set<(m: FrameMessage) => void>();
  const wait = (cb: (m: FrameMessage) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  let loaded: () => void = () => {};
  const loadedOnce = new Promise<void>((r) => (loaded = r));
  // The room a pane gives, as the card will: a fitted page isn't too tall.
  const { stop } = loadVisualFrame(
    iframe,
    check.html,
    (m) => {
      if (m.kind === "loaded") loaded();
      for (const cb of listeners) cb(m);
    },
    VISUAL_FIT_HEIGHT,
  );
  document.body.appendChild(iframe);
  let cancelled = false;
  const cleanup = () => {
    stop();
    iframe.remove();
  };
  const run = async (): Promise<VisualReport | null> => {
    await Promise.race([
      loadedOnce,
      new Promise((r) => window.setTimeout(r, LOAD_MS)),
    ]);
    if (cancelled) return null;
    const first = await askReport(iframe, wait, 1_000);
    if (!first || cancelled) return first;
    iframe.style.height = `${PROBE_TALL}px`;
    await new Promise((r) => window.setTimeout(r, RESIZE_MS));
    const tall = cancelled ? null : await askReport(iframe, wait, 800);
    return mergeProbeReports(first, tall, PROBE_TALL - PROBE_HEIGHT);
  };
  const done = Promise.race([
    run(),
    new Promise<null>((r) => window.setTimeout(() => r(null), CHECK_MS)),
  ]).finally(cleanup);
  return {
    done,
    cancel: () => {
      cancelled = true;
      cleanup();
    },
  };
}

/**
 * The page's probe of every chat's visuals: a `visual_check` heard live is
 * checked at once; one replayed after a reload only if its `visual_checked`
 * didn't follow (a finished check is never run again). A replayed check
 * carries no page (the server's log keeps none): the full one the server
 * sends for a check still open is the one run. A chat that ends drops its
 * checks: no report goes to a server that is gone (it would start again
 * for nothing). `report` sends the result to the chat's server.
 */
export function createVisualProbe(
  report: (chatId: string, checkId: string, result: VisualReport) => void,
  probe: typeof probeVisual = probeVisual,
) {
  const running = new Map<string, { chatId: string; cancel: () => void }>();
  /** Checks seen while their chat replays, by chat: started at `replayed`. */
  const held = new Map<string, Map<string, VisualCheck>>();
  const stop = (checkId: string) => {
    running.get(checkId)?.cancel();
    running.delete(checkId);
  };
  const start = (check: VisualCheck) => {
    if (running.has(check.checkId)) return;
    const run = probe(check);
    const entry = { chatId: check.chatId, cancel: run.cancel };
    running.set(check.checkId, entry);
    void run.done.then((result) => {
      if (running.get(check.checkId) !== entry) return;
      running.delete(check.checkId);
      if (result) report(check.chatId, check.checkId, result);
    });
  };
  return (event: ChatEvent, replaying: boolean) => {
    if (!("chatId" in event) || !event.chatId) return;
    const chatId = event.chatId;
    if (event.type === "attached") held.set(chatId, new Map());
    else if (event.type === "visual_check") {
      if (event.html === null) return;
      const check = {
        chatId,
        checkId: event.checkId,
        html: event.html,
        wide: event.wide,
      };
      const replay = replaying ? held.get(chatId) : undefined;
      if (replay) replay.set(event.checkId, check);
      else start(check);
    } else if (event.type === "visual_checked") {
      held.get(chatId)?.delete(event.checkId);
      stop(event.checkId);
    } else if (event.type === "replayed") {
      const waiting = held.get(chatId);
      held.delete(chatId);
      for (const check of waiting?.values() ?? []) start(check);
    } else if (event.type === "closed") {
      held.delete(chatId);
      for (const [checkId, run] of [...running])
        if (run.chatId === chatId) stop(checkId);
    }
  };
}
