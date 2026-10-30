import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { useHiddenVoice, type VoiceStatus } from "@/lib/useHiddenVoice";

/**
 * Temporary Lab panel (Ctrl+Alt+V) to try Claude's dictation with no
 * terminal on screen, until the chat view's input takes its mic button.
 * Click to start, click again to stop: the rail's gesture.
 */
const LABELS: Record<VoiceStatus, string> = {
  idle: "Clique sur le micro pour dicter",
  starting: "Démarrage du vocal…",
  listening: "J'écoute… clique pour arrêter",
  transcribing: "Transcription…",
};

export function VoiceTestPanel() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const append = useCallback(
    (dictated: string) =>
      setText((prev) =>
        prev.trim() ? `${prev.trimEnd()} ${dictated}` : dictated,
      ),
    [],
  );
  const voice = useHiddenVoice(append);

  // Capture phase: a focused terminal would take the keys first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Closing the panel stops the microphone: nothing would show it recording.
  const { status, stop } = voice;
  useEffect(() => {
    if (!open && (status === "listening" || status === "starting")) {
      void stop();
    }
  }, [open, status, stop]);

  if (!open) return null;

  const busy = voice.status === "starting" || voice.status === "transcribing";
  const toggle = () => {
    if (voice.status === "listening" || voice.status === "starting") {
      void voice.stop();
    } else if (voice.status === "idle") {
      void voice.start();
    }
  };

  return (
    <div className="fixed right-6 bottom-6 z-50 w-[440px] rounded-2xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-200 shadow-2xl">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-semibold">Test du vocal de Claude</span>
        <span className="text-xs text-zinc-500">sans terminal</span>
        <button
          type="button"
          className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={() => setOpen(false)}
          title="Fermer (Ctrl+Alt+V)"
        >
          <X size={16} />
        </button>
      </div>
      <textarea
        className="h-28 w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100 outline-none focus:border-zinc-500"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Le texte dicté arrive ici."
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={voice.status === "transcribing"}
          className={`grid h-10 w-10 place-items-center rounded-full ${
            voice.status === "listening"
              ? "bg-red-500 text-white"
              : "bg-orange-400 text-zinc-950"
          } disabled:opacity-60`}
          title={voice.status === "listening" ? "Arrêter la dictée" : "Dicter"}
        >
          {busy ? (
            <LoaderCircle size={18} className="animate-spin" />
          ) : voice.status === "listening" ? (
            <Square size={16} />
          ) : (
            <Mic size={18} />
          )}
        </button>
        <span className="text-zinc-400">{LABELS[voice.status]}</span>
      </div>
      {voice.error && (
        <p className="mt-2 text-xs text-red-400">{voice.error}</p>
      )}
    </div>
  );
}
