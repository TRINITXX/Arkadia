import { useCallback, useEffect, useRef, useState } from "react";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import {
  addResult,
  EMPTY_TRANSCRIPT,
  transcriptText,
  type TranscriptState,
} from "@/lib/dictationTranscript";

export type DictationPhase = "idle" | "listening" | "stopping";

export interface DictationState {
  phase: DictationPhase;
  /** Words recognised so far, updated while Alexis speaks. */
  transcript: string;
  /** Input level from 0 to 1, for the waveform. */
  level: number;
  error: string | null;
}

const ERRORS: Record<string, string> = {
  "not-allowed":
    "Autorise le micro et la reconnaissance vocale pour Arkadia dans Réglages.",
  "service-not-allowed":
    "La reconnaissance vocale est désactivée sur cet iPhone.",
  "language-not-supported":
    "Le français n'est pas disponible pour la reconnaissance vocale.",
  "no-speech": "Je n'ai rien entendu.",
  "audio-capture": "Le micro est indisponible.",
  network: "Pas de réseau pour la reconnaissance vocale.",
};

const IDLE: DictationState = {
  phase: "idle",
  transcript: "",
  level: 0,
  error: null,
};

/**
 * The iPhone's own speech recognition, in French (KalorApp's hook, which runs
 * on Alexis's iPhone): Claude Code's voice mode hears the PC's microphone,
 * never the phone's. `finish()` stops and resolves with the final text.
 */
export function useDictation() {
  const [state, setState] = useState<DictationState>(IDLE);
  const transcriptRef = useRef<TranscriptState>(EMPTY_TRANSCRIPT);
  const listeningRef = useRef(false);
  const finishResolvers = useRef<((text: string) => void)[]>([]);
  // The permission prompt can outlive the screen: no microphone after it left.
  const mounted = useRef(true);

  useEffect(() => {
    const m = ExpoSpeechRecognitionModule;
    mounted.current = true;
    const subs = [
      m.addListener("result", (e) => {
        transcriptRef.current = addResult(transcriptRef.current, e);
        const text = transcriptText(transcriptRef.current);
        setState((s) => ({ ...s, transcript: text }));
      }),
      m.addListener("volumechange", (e) => {
        setState((s) => ({
          ...s,
          level: Math.max(0, Math.min(e.value / 10, 1)),
        }));
      }),
      m.addListener("error", (e) => {
        if (e.error === "aborted") return;
        setState((s) => ({
          ...s,
          error: ERRORS[e.error] ?? "La dictée a échoué.",
        }));
      }),
      m.addListener("end", () => {
        listeningRef.current = false;
        const text = transcriptText(transcriptRef.current);
        setState((s) => ({ ...s, phase: "idle", level: 0, transcript: text }));
        const resolvers = finishResolvers.current;
        finishResolvers.current = [];
        resolvers.forEach((resolve) => resolve(text));
      }),
    ];
    return () => {
      subs.forEach((sub) => sub.remove());
      // Leaving the screen must close the microphone: continuous mode has no
      // silence timer, and a session left running breaks the next start().
      if (listeningRef.current) m.abort();
      listeningRef.current = false;
      mounted.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    const m = ExpoSpeechRecognitionModule;
    transcriptRef.current = EMPTY_TRANSCRIPT;
    setState({ ...IDLE, phase: "listening" });
    const permission = await m.requestPermissionsAsync();
    if (!mounted.current) return;
    if (!permission.granted) {
      setState({ ...IDLE, error: ERRORS["not-allowed"] });
      return;
    }
    listeningRef.current = true;
    m.start({
      lang: "fr-FR",
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    });
  }, []);

  const finish = useCallback((): Promise<string> => {
    setState((s) => ({ ...s, phase: "stopping" }));
    return new Promise((resolve) => {
      finishResolvers.current.push(resolve);
      ExpoSpeechRecognitionModule.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
    listeningRef.current = false;
    finishResolvers.current = [];
    setState(IDLE);
  }, []);

  const clearError = useCallback(
    () => setState((s) => ({ ...s, error: null })),
    [],
  );

  return { ...state, start, finish, cancel, clearError };
}
