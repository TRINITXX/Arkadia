import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  CornerDownLeft,
  Copy,
  Eraser,
  Images,
  MessagesSquare,
  Mic,
  Square,
} from "lucide-react";
import { FilePicker, prefetchPhotos } from "@/components/FilePicker";
import { measureCellSize } from "@/lib/cellSize";
import { copiedCodeMessage } from "@/lib/codeCopy";
import { usePaneFrameSelector } from "@/lib/frameStore";
import { focusPaneElement } from "@/lib/paneFocus";
import { quotePathsForPrompt } from "@/lib/pickerPrompt";
import { CLEAR_CHUNK_GAP_MS, clearPromptChunks } from "@/lib/promptClear";
import { inputRowIndex, isPromptField } from "@/lib/terminalChrome";
import type { TerminalFont } from "@/types";

/**
 * Claude Code's hold-to-talk (`space` → `voice:pushToTalk`) reads a *held* key
 * the only way a PTY can express one: the auto-repeat burst of `0x20`. So
 * "holding" the button = writing a space on a keyboard-repeat cadence, and
 * "releasing" = simply stopping. 40ms (25/s) sits near the fastest a real
 * Windows key repeat goes, well inside any release timeout.
 */
const SPACE_REPEAT_MS = 40;

/** Safety net: never leave a runaway space burst going if the click is forgotten. */
const MAX_TALK_MS = 10 * 60 * 1000;

/** Side of a rail button (Tailwind `size-6`), needed to centre the stack. */
const BUTTON_PX = 24;

/** Gap kept between the stack's top and the pane's top edge. */
const TOP_GAP_PX = 4;

/** How long the copy button holds its ✓ before going back to its icon. */
const COPIED_MS = 1200;

interface PaneInputRailProps {
  paneId: string;
  font: TerminalFont;
  /** The WebGPU terminal pads by 20px, the canvas one by 12 (Tailwind p-3). */
  useWebGPU: boolean;
  onToast?: (level: "info" | "error", message: string) => void;
}

/**
 * Six keyboard-free actions for the active pane: show the prompts and replies
 * alone (the display mod hides the rest), pick files from the camera roll or the
 * downloads folder, hold/release space for voice dictation (click to start,
 * click to stop), copy the last code block Claude wrote, erase the typed prompt,
 * and send it (Enter).
 *
 * Stacked vertically against the right edge rather than laid out in a row, so
 * they cover one column of Claude Code's input box instead of three — a long
 * prompt used to run underneath them and become unreadable. Enter keeps the spot
 * it has always had, level with the `❯` line, and the others climb above it;
 * growing downwards would land on the hint row under the box. In a pane too
 * short for the whole column, the top buttons wrap into a second column to
 * the left rather than climb past the pane's edge, which clips them.
 *
 * Hidden whenever the pane shows no `❯` input line — except while dictating,
 * when Claude Code replaces that line with its recording UI.
 */
export function PaneInputRail({
  paneId,
  font,
  useWebGPU,
  onToast,
}: PaneInputRailProps) {
  const rowIdx = usePaneFrameSelector(paneId, inputRowIndex);
  const canClear = usePaneFrameSelector(paneId, isPromptField);
  const [talking, setTalking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [onlyMessages, setOnlyMessages] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  // Interval writing the repeated spaces + the runaway stop, so both survive
  // re-renders and get cleared on unmount / pane change.
  const repeatRef = useRef(0);
  const capRef = useRef(0);
  // Timer resetting the copy button's ✓.
  const copiedRef = useRef(0);
  // A burst of erase keys is on its way: a second click would interleave its
  // writes and could merge them into one read Claude Code takes for a paste.
  const clearingRef = useRef(false);

  const send = useCallback(
    (bytes: number[]) => {
      void invoke("send_input", { sessionId: paneId, bytes }).catch((e) =>
        onToast?.("error", String(e)),
      );
    },
    [paneId, onToast],
  );

  useEffect(() => () => window.clearTimeout(copiedRef.current), []);

  // The pane's flag lives in its file, which the mod reads: read back on each
  // pane switch and remount, so the button never contradicts the transcript.
  useEffect(() => {
    let isCurrent = true;
    void invoke<boolean>("messages_only_get", { paneId })
      .then((on) => {
        if (isCurrent) setOnlyMessages(on);
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, [paneId]);

  const toggleOnlyMessages = () => {
    const on = !onlyMessages;
    setOnlyMessages(on);
    void invoke("messages_only_set", { paneId, on }).catch((e) => {
      setOnlyMessages(!on);
      onToast?.("error", String(e));
    });
  };

  /**
   * Copies the last fenced code block of this pane's conversation — the modern
   * view's per-fence copy button, without opening the view. The toast echoes
   * the block's first line: the block itself is off-screen, so that line is the
   * only way to tell it grabbed the right one.
   */
  const copyLastCode = useCallback(async () => {
    let code: string | null;
    try {
      code = await invoke<string | null>("read_last_code_block", { paneId });
    } catch {
      onToast?.("error", "Aucune conversation Claude dans cet onglet");
      return;
    }
    if (!code) {
      onToast?.("error", "Aucun bloc de code récent dans cette conversation");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
    } catch (e) {
      onToast?.("error", `Copie impossible : ${String(e)}`);
      return;
    }
    onToast?.("info", copiedCodeMessage(code));
    setCopied(true);
    window.clearTimeout(copiedRef.current);
    copiedRef.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }, [paneId, onToast]);

  /**
   * Empties Claude Code's prompt. Writes go one at a time, awaited and spaced,
   * so they reach Claude Code in order and as separate reads. Runs to the end
   * even if the rail unmounts meanwhile: it acts on the pane, not on React
   * state. The first failed write (pane closed) stops it.
   */
  const clearPrompt = useCallback(async () => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    try {
      const chunks = clearPromptChunks();
      for (const [i, bytes] of chunks.entries()) {
        if (i > 0) {
          await new Promise((r) => window.setTimeout(r, CLEAR_CHUNK_GAP_MS));
        }
        await invoke("send_input", { sessionId: paneId, bytes });
      }
    } catch (e) {
      onToast?.("error", String(e));
    } finally {
      clearingRef.current = false;
    }
  }, [paneId, onToast]);

  const stopTalking = useCallback(() => {
    window.clearInterval(repeatRef.current);
    window.clearTimeout(capRef.current);
    repeatRef.current = 0;
    capRef.current = 0;
    setTalking(false);
  }, []);

  // A pane switch (or the rail unmounting) must never leave spaces flowing.
  useEffect(() => stopTalking, [stopTalking, paneId]);

  const closePicker = useCallback(() => {
    setPicking(false);
    focusPaneElement(paneId);
  }, [paneId]);

  // Click anywhere outside the rail dismisses the picker. The test covers the
  // whole rail, not just the panel, so clicking the picker's own button while it
  // is open doesn't close it here and reopen it on the click that follows.
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: MouseEvent) => {
      if (!railRef.current?.contains(e.target as Node)) closePicker();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [picking, closePicker]);

  const insertFiles = useCallback(
    (paths: string[]) => {
      const text = quotePathsForPrompt(paths);
      if (text) send(Array.from(new TextEncoder().encode(text)));
      closePicker();
    },
    [send, closePicker],
  );

  // Last known input row. While dictating, Claude Code may replace the `❯` line
  // with its recording UI — the buttons then hold their spot instead of
  // vanishing, so the one that stops the dictation stays reachable.
  const [lastRow, setLastRow] = useState(-1);
  useEffect(() => {
    if (rowIdx >= 0) setLastRow(rowIdx);
  }, [rowIdx]);

  const toggleTalking = () => {
    if (talking) {
      stopTalking();
      return;
    }
    setTalking(true);
    send([0x20]);
    repeatRef.current = window.setInterval(() => send([0x20]), SPACE_REPEAT_MS);
    capRef.current = window.setTimeout(stopTalking, MAX_TALK_MS);
  };

  // While dictating or picking, hold the last known spot rather than vanishing
  // mid-interaction on a frame that momentarily has no `❯`.
  const row = rowIdx >= 0 ? rowIdx : talking || picking ? lastRow : -1;
  if (row < 0) return null;

  const { height: cellH } = measureCellSize(font.family, font.size);
  const pad = useWebGPU ? 20 : 12;
  const stackBottom = (cellH - BUTTON_PX) / 2;
  // Height between the pane's top edge and the stack's bottom: past it the
  // column wraps (`flex-wrap-reverse` keeps Enter's column on the right).
  const stackRoom = pad + (row + 1) * cellH - stackBottom - TOP_GAP_PX;
  // The picker sits on the `❯` row's top edge, so the prompt stays readable.
  const pickerBottom = cellH - stackBottom;

  return (
    <div
      ref={railRef}
      className="pointer-events-none absolute right-1 z-40"
      style={{ top: pad + row * cellH, height: cellH }}
      // Keep the terminal focused: the click acts on it, it must not steal it.
      // (The picker panel stops this from reaching here — it wants the focus.)
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* `flex-col-reverse` renders the first child at the bottom, so Enter keeps
          the spot it has always had, level with the `❯` line, and the others
          climb above it. The offset centres that bottom button on the row rather
          than letting it hang below. Read top to bottom, the order is the one the
          row used to have left to right, « Messages seuls » added on top and
          « Effacer » slipped in just above Enter. */}
      <div
        className="absolute right-0 flex flex-col-reverse flex-wrap-reverse items-center gap-1"
        style={{ bottom: stackBottom, maxHeight: stackRoom }}
      >
        {picking && (
          <FilePicker
            onInsert={insertFiles}
            onClose={closePicker}
            bottom={pickerBottom}
            maxHeight={stackRoom - pickerBottom}
          />
        )}
        <button
          type="button"
          onClick={() => send([0x0d])}
          title="Envoyer le message (Entrée)"
          aria-label="Envoyer le message"
          className="pointer-events-auto flex size-6 items-center justify-center rounded bg-[rgba(34,197,94,0.10)] text-zinc-400 transition-colors hover:bg-[rgba(34,197,94,0.20)] hover:text-zinc-100"
        >
          <CornerDownLeft size={12} />
        </button>
        <button
          type="button"
          onClick={() => void clearPrompt()}
          // Off while the `❯` line isn't the text field (transcript, selector):
          // there the same keys toggle views and scroll.
          disabled={!canClear}
          title="Effacer tout le message en cours d'écriture"
          aria-label="Effacer le message"
          className="pointer-events-auto flex size-6 items-center justify-center rounded bg-[rgba(148,163,184,0.10)] text-zinc-400 transition-colors enabled:hover:bg-[rgba(148,163,184,0.20)] enabled:hover:text-zinc-100 disabled:opacity-40"
        >
          <Eraser size={12} />
        </button>
        <button
          type="button"
          onClick={() => void copyLastCode()}
          title="Copier le dernier bloc de code de Claude"
          aria-label="Copier le dernier bloc de code"
          className={`pointer-events-auto flex size-6 items-center justify-center rounded transition-colors ${
            copied
              ? "bg-[rgba(245,158,11,0.28)] text-amber-200"
              : "bg-[rgba(245,158,11,0.10)] text-zinc-400 hover:bg-[rgba(245,158,11,0.20)] hover:text-zinc-100"
          }`}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        <button
          type="button"
          onClick={toggleTalking}
          title={
            talking
              ? "Arrêter la dictée (relâche espace)"
              : "Dicter (maintient espace)"
          }
          aria-label={talking ? "Arrêter la dictée" : "Dicter"}
          aria-pressed={talking}
          className={`pointer-events-auto flex size-6 items-center justify-center rounded transition-colors ${
            talking
              ? "bg-[rgba(239,68,68,0.25)] text-red-300 hover:bg-[rgba(239,68,68,0.35)]"
              : "bg-[rgba(168,85,247,0.10)] text-zinc-400 hover:bg-[rgba(168,85,247,0.20)] hover:text-zinc-100"
          }`}
        >
          {talking ? (
            <Square size={11} fill="currentColor" />
          ) : (
            <Mic size={12} />
          )}
        </button>
        <button
          type="button"
          onClick={() => (picking ? closePicker() : setPicking(true))}
          // Warm the listing and its thumbnails while the pointer travels, so the
          // panel usually has something to paint the moment it opens.
          onMouseEnter={prefetchPhotos}
          title="Insérer des fichiers (photos, téléchargements)"
          aria-label="Insérer des fichiers"
          aria-pressed={picking}
          className={`pointer-events-auto flex size-6 items-center justify-center rounded transition-colors ${
            picking
              ? "bg-[rgba(56,189,248,0.28)] text-sky-200"
              : "bg-[rgba(56,189,248,0.10)] text-zinc-400 hover:bg-[rgba(56,189,248,0.20)] hover:text-zinc-100"
          }`}
        >
          <Images size={12} />
        </button>
        <button
          type="button"
          onClick={toggleOnlyMessages}
          title={
            onlyMessages ? "Tout afficher" : "Messages seuls (cache les outils)"
          }
          aria-label={onlyMessages ? "Tout afficher" : "Messages seuls"}
          aria-pressed={onlyMessages}
          className={`pointer-events-auto flex size-6 items-center justify-center rounded transition-colors ${
            onlyMessages
              ? "bg-[rgba(244,63,94,0.28)] text-rose-200"
              : "bg-[rgba(244,63,94,0.10)] text-zinc-400 hover:bg-[rgba(244,63,94,0.20)] hover:text-zinc-100"
          }`}
        >
          <MessagesSquare size={12} />
        </button>
      </div>
    </div>
  );
}
