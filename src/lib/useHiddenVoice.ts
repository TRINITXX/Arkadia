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
import { isOptionRow, isPromptField, voiceFailure } from "@/lib/terminalChrome";

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
/** Between two default answers to the folder-trust question. */
const ANSWER_GAP_MS = 1500;
/**
 * Longer than the hook's own timeout (10 s, `voice.rs`): past it the hook is
 * killed and blocks the prompt, so no text can land after this dictation gave
 * up and pass for the next one's.
 */
const CAPTURE_TIMEOUT_MS = 11_000;
const CAPTURE_POLL_MS = 100;
/** A wide grid keeps a long dictation on few rows. */
const COLS = 160;
const ROWS = 40;

const ENTER = [0x0d];
const SPACE = [0x20];

function send(paneId: string, bytes: number[]): Promise<void> {
  return invoke("send_input", { sessionId: paneId, bytes });
}

/**
 * Resolves true once the pane shows Claude Code's prompt field. The question
 * whether to trust the folder gets Enter, its default answer: any other list
 * (choosing how to sign in) waits for a person.
 */
function waitForPrompt(paneId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let lastAnswer = 0;
    const finish = (ready: boolean) => {
      unsubscribe();
      clearTimeout(giveUp);
      resolve(ready);
    };
    const check = () => {
      const frame = getFrame(paneId);
      if (isPromptField(frame)) {
        finish(true);
        return;
      }
      const asking = frame?.lines.some((runs) => isOptionRow(runs)) ?? false;
      const trust =
        frame?.lines.some((runs) =>
          /trust/i.test(runs.map((r) => r.text).join("")),
        ) ?? false;
      if (asking && trust && Date.now() - lastAnswer > ANSWER_GAP_MS) {
        lastAnswer = Date.now();
        void send(paneId, ENTER).catch(() => {});
      }
    };
    const unsubscribe = subscribeFrame(paneId, check);
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
// click too short that typed real spaces. Held space only dictates into an
// empty prompt, so the next dictation empties it first. Unknown at load.
let promptMayHoldText = true;

/**
 * The hidden Claude Code, its prompt field on screen. Checked on every
 * dictation, instantly when the field shows: a pane stuck on anything else is
 * closed, and the next dictation gets a fresh one.
 */
async function hiddenPane(): Promise<string> {
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
 * Makes the prompt empty before a dictation. A dictation cut short may still
 * be transcribing: its text would land after a clear, so it is waited for,
 * and one that never ends stops this dictation too.
 */
async function emptyPrompt(paneId: string): Promise<void> {
  if (!promptMayHoldText) return;
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
  const stopRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
      if (repeatRef.current !== undefined) void stopRef.current();
    };
  }, []);

  /** Releases space, waits for the transcript, and hands its text on. */
  const stop = useCallback(async () => {
    const paneId = paneRef.current;
    if (!paneId || repeatRef.current === undefined) {
      cancelRef.current = true;
      return;
    }
    stopSpaces();
    setStatus("transcribing");
    try {
      // Enter only on the prompt field: on a dialog it would pick its
      // default answer, and mid-transcription it would send half the text.
      const ended = await waitForDictationEnd(paneId);
      const frame = getFrame(paneId);
      if (!ended || !isPromptField(frame)) {
        throw new Error("La transcription n'a pas abouti");
      }
      const failure = voiceFailure(frame);
      if (failure) throw new Error(`Claude Code : ${failure}`);
      await send(paneId, ENTER);
      const text = await takeCapture(paneId);
      if (!text) throw new Error("Aucun texte reçu de la dictée");
      // Captured: the hook blocked the prompt, which leaves it empty.
      promptMayHoldText = false;
      onTextRef.current(text);
    } catch (e) {
      if (mountedRef.current) setError(message(e));
    } finally {
      busy = false;
      releasePane();
      if (mountedRef.current) setStatus("idle");
    }
  }, [stopSpaces, releasePane]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(async () => {
    if (status !== "idle") return;
    if (busy) {
      setError("Une autre dictée est en cours");
      return;
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
      return;
    }
    if (cancelRef.current || !mountedRef.current) {
      busy = false;
      if (mountedRef.current) setStatus("idle");
      return;
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
    setStatus("listening");
  }, [status, stop]);

  /** The caller showed the error: the next one, even the same, shows again. */
  const clearError = useCallback(() => setError(null), []);

  return { status, error, clearError, start, stop };
}
