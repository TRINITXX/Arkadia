import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { waitForDictationEnd } from "@/lib/dictationEnd";
import {
  adoptPane,
  getFrame,
  releaseAdoptedPane,
  subscribeFrame,
} from "@/lib/frameStore";
import { CLEAR_CHUNK_GAP_MS, clearPromptChunks } from "@/lib/promptClear";
import { holdPaneShown } from "@/lib/shownPanes";
import {
  isPromptField,
  promptFieldText,
  trustAnswerKey,
  voiceFailure,
  voiceFailureText,
} from "@/lib/terminalChrome";

/**
 * Claude's own dictation without a terminal on screen, for the chat view:
 * the hidden Claude Code that `voice.rs` keeps running records, and its hook
 * hands the text back. Same gestures as the rail's dictation button: a held
 * space is a burst of `0x20` on a key-repeat cadence, then Enter once the
 * transcript is in.
 */
export type VoiceStatus = "idle" | "starting" | "listening" | "transcribing";

/** Keyboard auto-repeat cadence, as the rail (`PaneInputRail`). */
const SPACE_REPEAT_MS = 40;
/** Safety net: never leave a runaway space burst going. */
const MAX_TALK_MS = 10 * 60_000;
/** Claude Code takes a few seconds to start; past this it is stuck. */
const READY_TIMEOUT_MS = 30_000;
/** Between two keys answering the folder-trust question. */
const ANSWER_GAP_MS = 1500;
/** How long the screen must stay unchanged before a key goes to it. */
const SETTLE_MS = 500;
const CHECK_MS = 250;
/**
 * Longer than the hook's own timeout (10 s, `voice.rs`): past it the hook is
 * killed and blocks the prompt, so no text can land after this dictation gave
 * up and pass for the next one's.
 */
const CAPTURE_TIMEOUT_MS = 11_000;
const CAPTURE_POLL_MS = 100;
/** A blocked prompt comes back in the field a beat after its hook ran. */
const RESTORE_WAIT_MS = 2_000;
/** The clearing keys' effect on screen. */
const EMPTY_WAIT_MS = 1_500;
/** A wide grid keeps a long dictation on few rows. */
const COLS = 160;
const ROWS = 40;

const ENTER = [0x0d];
const SPACE = [0x20];
const DOWN = [0x1b, 0x5b, 0x42];

function send(paneId: string, bytes: number[]): Promise<void> {
  return invoke("send_input", { sessionId: paneId, bytes });
}

/**
 * Resolves true once the pane shows Claude Code's prompt field. The question
 * whether to trust the folder gets yes: any other list (choosing how to sign
 * in) waits for a person. A dialog at rest draws nothing, so no frame comes
 * after the one a key caused: the screen is checked on a timer too. Keys go
 * only to a screen that stopped changing: a key sent right as the dialog
 * appears is undone (its cursor back on the default answer).
 */
export function waitForPrompt(paneId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let lastFrameAt = Date.now();
    let lastAnswer = 0;
    const finish = (ready: boolean) => {
      unsubscribe();
      clearInterval(tick);
      clearTimeout(giveUp);
      resolve(ready);
    };
    const check = () => {
      const frame = getFrame(paneId);
      if (isPromptField(frame)) {
        finish(true);
        return;
      }
      const now = Date.now();
      if (now - lastFrameAt < SETTLE_MS || now - lastAnswer < ANSWER_GAP_MS) {
        return;
      }
      const key = frame ? trustAnswerKey(frame.lines) : null;
      if (!key) return;
      lastAnswer = now;
      void send(paneId, key === "enter" ? ENTER : DOWN).catch(() => {});
    };
    const unsubscribe = subscribeFrame(paneId, () => {
      lastFrameAt = Date.now();
      check();
    });
    const tick = setInterval(check, CHECK_MS);
    const giveUp = setTimeout(() => finish(false), READY_TIMEOUT_MS);
    check();
  });
}

// The hidden Claude Code last seen ready. The Rust side keeps the pane across
// page reloads and replaces it when its Claude Code quit, so every dictation
// asks for it again and only a new one is waited for.
let readyId: string | null = null;
// One dictation at a time: two would mix their spaces and take each other's
// text (the capture is kept per pane).
let busy = false;
// The prompt may hold something: a dictation cut short, a reload mid-way, a
// click too short that typed real spaces, and every captured dictation:
// Claude Code puts the prompt its hook blocked back in the field (v2.1.316).
// A dictation inserts its words at the cursor, after what the field holds,
// so the next one would bring the old text back: emptied first. Unknown at
// load.
let promptMayHoldText = true;
// The field being emptied after a capture (`emptyAfterCapture`): the next
// dictation waits for it.
let settling: Promise<void> = Promise.resolve();

/**
 * The hidden Claude Code, its prompt field on screen. Checked on every
 * dictation, instantly when the field shows: a pane stuck on anything else is
 * closed, and the next dictation gets a fresh one.
 */
function hiddenPane(): Promise<string> {
  // One at a time: a warm-up and a dictation never both answer its dialogs.
  pendingPane ??= readyPane().finally(() => {
    pendingPane = null;
  });
  return pendingPane;
}
let pendingPane: Promise<string> | null = null;

async function readyPane(): Promise<string> {
  const paneId = await invoke<string>("voice_pane", { cols: COLS, rows: ROWS });
  if (paneId !== readyId) {
    if (readyId) releaseAdoptedPane(readyId);
    // Not always a fresh Claude Code: after a page reload it is the same one,
    // whose prompt may hold a dictation cut short. `promptMayHoldText` stays.
    readyId = paneId;
    adoptPane(paneId);
  }
  const release = holdPaneShown(paneId);
  try {
    if (!(await waitForPrompt(paneId))) {
      await invoke("close_terminal", { sessionId: paneId }).catch(() => {});
      releaseAdoptedPane(paneId);
      readyId = null;
      throw new Error("Le Claude Code du vocal ne répond pas");
    }
  } finally {
    release();
  }
  return paneId;
}

/**
 * Starts the hidden Claude Code ahead of the first dictation, so the mic's
 * first click listens at once instead of after its few seconds of start
 * (the user's ask of 01/11/2026). It stays up afterwards, as after a
 * dictation; a failure is silent, the first dictation tries again.
 */
export function warmHiddenVoice(): void {
  if (readyId || busy) return;
  void hiddenPane().catch(() => {});
}

/**
 * Makes the prompt empty before a dictation. A dictation cut short may still
 * be transcribing: its text would land after a clear, so it is waited for,
 * and one that never ends stops this dictation too.
 */
async function emptyPrompt(paneId: string): Promise<void> {
  await settling;
  // The screen has the last word: a restore later than `emptyAfterCapture`
  // waited for still shows.
  if (!promptMayHoldText && !promptFieldText(getFrame(paneId))) return;
  const release = holdPaneShown(paneId);
  try {
    if (!(await waitForDictationEnd(paneId))) {
      throw new Error("La dictée précédente n'a pas fini sa transcription");
    }
  } finally {
    release();
  }
  await clearPrompt(paneId);
}

/** Empties the prompt with the rail's keys (`promptClear`), in small writes. */
async function clearPrompt(paneId: string): Promise<void> {
  for (const [i, bytes] of clearPromptChunks().entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, CLEAR_CHUNK_GAP_MS));
    await send(paneId, bytes);
  }
}

/** Resolves true once the field's text passes `test`, false after `ms`. */
function waitForField(
  paneId: string,
  test: (text: string) => boolean,
  ms: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(ok);
    };
    const check = () => {
      const text = promptFieldText(getFrame(paneId));
      if (text !== null && test(text)) finish(true);
    };
    const unsubscribe = subscribeFrame(paneId, check);
    const timer = setTimeout(() => finish(false), ms);
    check();
  });
}

/**
 * After a capture: the blocked prompt comes back in the field (v2.1.316),
 * so it is emptied at once, before anyone dictates again. Counted empty only
 * once the screen says so; else the next dictation empties it again.
 */
export async function emptyAfterCapture(paneId: string): Promise<void> {
  const release = holdPaneShown(paneId);
  try {
    await waitForField(paneId, (text) => text !== "", RESTORE_WAIT_MS);
    await clearPrompt(paneId);
    if (await waitForField(paneId, (text) => text === "", EMPTY_WAIT_MS)) {
      promptMayHoldText = false;
    }
  } catch {
    // The pane went: the next dictation gets a new one, emptied first.
  } finally {
    release();
  }
}

/** The text the hook kept, polled until it lands; null if nothing came. */
async function takeCapture(paneId: string): Promise<string | null> {
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const text = await invoke<string | null>("voice_take", { paneId });
    if (text) return text;
    await new Promise((r) => setTimeout(r, CAPTURE_POLL_MS));
  }
  return null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** How a stop ended: the text handed to `onText`, or why not. */
export type DictationEnd = { ok: true } | { ok: false; error: string };

/**
 * Whether the hook shows a failed dictation itself: not while a caller that
 * asked for quiet is still there to show it (`quiet` answers), so the
 * failure shows once, never twice nor not at all.
 */
export function hookReportsFailure(quiet: (() => boolean) | null): boolean {
  return !quiet?.();
}

/**
 * `onText` gets each finished dictation, the safety stop's included, even
 * once the component unmounted: it must write somewhere that outlives it
 * (`chatDrafts`).
 */
export function useHiddenVoice(onText: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);
  const mountedRef = useRef(true);
  const paneRef = useRef<string | null>(null);
  const repeatRef = useRef<number | undefined>(undefined);
  const capRef = useRef<number | undefined>(undefined);
  const releaseRef = useRef<(() => void) | null>(null);
  // A stop asked while the hidden Claude Code still starts.
  const cancelRef = useRef(false);
  // The words so far, read off the hidden field as the terminal shows them
  // (dim until final), while it records and transcribes. Frozen once Enter
  // goes (the field empties and refills), gone once the text lands.
  const [interim, setInterim] = useState("");
  const unwatchRef = useRef<(() => void) | null>(null);
  const unwatch = useCallback(() => {
    unwatchRef.current?.();
    unwatchRef.current = null;
  }, []);
  const watchField = useCallback(
    (paneId: string) => {
      unwatch();
      // The screen as it was: the field just emptied may not show yet, and
      // its old words are no live words (`emptyPrompt`).
      const before = getFrame(paneId);
      setInterim("");
      const read = () => {
        if (!mountedRef.current) return;
        const frame = getFrame(paneId);
        if (frame === before) return;
        const text = promptFieldText(frame, { dim: true });
        if (text !== null) setInterim(text);
      };
      unwatchRef.current = subscribeFrame(paneId, read);
    },
    [unwatch],
  );

  const stopSpaces = useCallback(() => {
    window.clearInterval(repeatRef.current);
    window.clearTimeout(capRef.current);
    repeatRef.current = undefined;
  }, []);

  const releasePane = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);

  // Unmounting stops the microphone, and a dictation under way still ends:
  // its text goes to `onText` like any other.
  const stopRef = useRef<() => Promise<DictationEnd>>(async () => ({
    ok: false,
    error: "Aucune dictée en cours",
  }));
  // The stop under way: a second stop (send after dictation) waits for it.
  const stoppingRef = useRef<Promise<DictationEnd> | null>(null);
  // A caller tells the failure itself while it is there (send after
  // dictation): no error here then (`hookReportsFailure`).
  const quietRef = useRef<(() => boolean) | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
      unwatchRef.current?.();
      if (repeatRef.current !== undefined) void stopRef.current();
    };
  }, []);

  /**
   * Releases space, waits for the transcript, and hands its text on. Resolves
   * once `onText` has it, or with why not. `quiet`: true while the caller is
   * there to show a failure, so `error` stays unset then (one message, not
   * two). A caller gone by then leaves the failure to `error`.
   */
  const stop = useCallback(
    (options?: { quiet?: () => boolean }): Promise<DictationEnd> => {
      if (options?.quiet) quietRef.current = options.quiet;
      if (stoppingRef.current) return stoppingRef.current;
      const paneId = paneRef.current;
      if (!paneId || repeatRef.current === undefined) {
        cancelRef.current = true;
        quietRef.current = null;
        return Promise.resolve({ ok: false, error: "Aucune dictée en cours" });
      }
      stopSpaces();
      setStatus("transcribing");
      const stopping = (async () => {
        try {
          // Enter only on the prompt field: on a dialog it would pick its
          // default answer, and mid-transcription it would send half the text.
          const ended = await waitForDictationEnd(paneId);
          const frame = getFrame(paneId);
          if (!ended || !isPromptField(frame)) {
            throw new Error("La transcription n'a pas abouti");
          }
          const failure = voiceFailure(frame);
          if (failure) throw new Error(voiceFailureText(failure));
          unwatch();
          await send(paneId, ENTER);
          const text = await takeCapture(paneId);
          if (!text) throw new Error("Aucun texte reçu de la dictée");
          // Captured, and soon back in the field: emptied before the next.
          promptMayHoldText = true;
          settling = emptyAfterCapture(paneId);
          if (mountedRef.current) setInterim("");
          onTextRef.current(text);
          return { ok: true } as const;
        } catch (e) {
          if (mountedRef.current && hookReportsFailure(quietRef.current)) {
            setError(message(e));
          }
          return { ok: false, error: message(e) } as const;
        } finally {
          busy = false;
          stoppingRef.current = null;
          quietRef.current = null;
          unwatch();
          releasePane();
          if (mountedRef.current) {
            setInterim("");
            setStatus("idle");
          }
        }
      })();
      stoppingRef.current = stopping;
      return stopping;
    },
    [stopSpaces, releasePane, unwatch],
  );
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  /** Resolves true once listening, false when it didn't start. */
  const start = useCallback(async (): Promise<boolean> => {
    if (status !== "idle") return false;
    if (busy) {
      setError("Une autre dictée est en cours");
      return false;
    }
    busy = true;
    cancelRef.current = false;
    setError(null);
    setStatus("starting");
    let paneId: string;
    try {
      paneId = await hiddenPane();
      await emptyPrompt(paneId);
      // A text the hook kept that nobody took.
      await invoke("voice_take", { paneId });
    } catch (e) {
      busy = false;
      if (mountedRef.current) {
        setError(message(e));
        setStatus("idle");
      }
      return false;
    }
    if (cancelRef.current || !mountedRef.current) {
      busy = false;
      if (mountedRef.current) setStatus("idle");
      return false;
    }
    paneRef.current = paneId;
    releaseRef.current = holdPaneShown(paneId);
    promptMayHoldText = true;
    void send(paneId, SPACE).catch(() => {});
    repeatRef.current = window.setInterval(
      () => void send(paneId, SPACE).catch(() => {}),
      SPACE_REPEAT_MS,
    );
    capRef.current = window.setTimeout(() => void stop(), MAX_TALK_MS);
    watchField(paneId);
    setStatus("listening");
    return true;
  }, [status, stop, watchField]);

  /** The caller showed the error: the next one, even the same, shows again. */
  const clearError = useCallback(() => setError(null), []);

  return { status, error, clearError, start, stop, interim };
}
