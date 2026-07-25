import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CornerDownLeft, Mic, Square } from "lucide-react";
import { measureCellSize } from "@/lib/cellSize";
import { usePaneFrameSelector } from "@/lib/frameStore";
import { inputRowIndex } from "@/lib/terminalChrome";
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
const MAX_TALK_MS = 3 * 60 * 1000;

interface PaneInputRailProps {
  paneId: string;
  font: TerminalFont;
  /** The WebGPU terminal pads by 20px, the canvas one by 12 (Tailwind p-3). */
  useWebGPU: boolean;
  onError?: (message: string) => void;
}

/**
 * Two keyboard-free actions for the active pane, pinned in the dead margin at
 * the exact height of Claude Code's input box: send the typed prompt (Enter),
 * and hold/release space for voice dictation (click to start, click to stop).
 * Hidden whenever the pane shows no `❯` input line.
 */
export function PaneInputRail({
  paneId,
  font,
  useWebGPU,
  onError,
}: PaneInputRailProps) {
  const rowIdx = usePaneFrameSelector(paneId, inputRowIndex);
  const [talking, setTalking] = useState(false);
  // Interval writing the repeated spaces + the runaway stop, so both survive
  // re-renders and get cleared on unmount / pane change.
  const repeatRef = useRef(0);
  const capRef = useRef(0);

  const send = useCallback(
    (bytes: number[]) => {
      void invoke("send_input", { sessionId: paneId, bytes }).catch((e) =>
        onError?.(String(e)),
      );
    },
    [paneId, onError],
  );

  const stopTalking = useCallback(() => {
    window.clearInterval(repeatRef.current);
    window.clearTimeout(capRef.current);
    repeatRef.current = 0;
    capRef.current = 0;
    setTalking(false);
  }, []);

  // A pane switch (or the rail unmounting) must never leave spaces flowing.
  useEffect(() => stopTalking, [stopTalking, paneId]);

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

  const row = rowIdx >= 0 ? rowIdx : talking ? lastRow : -1;
  if (row < 0) return null;

  const { height: cellH } = measureCellSize(font.family, font.size);
  const pad = useWebGPU ? 20 : 12;

  return (
    <div
      className="pointer-events-none absolute right-1 z-40 flex items-center gap-1"
      style={{ top: pad + row * cellH, height: cellH }}
      // Keep the terminal focused: the click acts on it, it must not steal it.
      onMouseDown={(e) => e.preventDefault()}
    >
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
        {talking ? <Square size={11} fill="currentColor" /> : <Mic size={12} />}
      </button>
      <button
        type="button"
        onClick={() => send([0x0d])}
        title="Envoyer le message (Entrée)"
        aria-label="Envoyer le message"
        className="pointer-events-auto flex size-6 items-center justify-center rounded bg-[rgba(34,197,94,0.10)] text-zinc-400 transition-colors hover:bg-[rgba(34,197,94,0.20)] hover:text-zinc-100"
      >
        <CornerDownLeft size={12} />
      </button>
    </div>
  );
}
