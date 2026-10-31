import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import type { DictationEnd, VoiceStatus } from "@/lib/useHiddenVoice";

export const DICTATION_FAILED =
  "La dictée ne se termine pas : message non envoyé";

/**
 * Enter or the send button while a dictation runs, as the terminal rail does
 * (`PaneInputRail`): the dictation stops, its text lands in the draft, then
 * the whole draft goes. `waiting` meanwhile (the send button pulses). A
 * dictation that fails sends nothing and keeps the draft, with one toast:
 * this one, which says both, or the voice hook's own when this input was
 * already gone as it failed (a request took its place).
 *
 * `send(now)` sends the draft the input holds when it is called.
 */
export function useSendAfterDictation(
  voice: {
    status: VoiceStatus;
    stop: (options?: { quiet?: () => boolean }) => Promise<DictationEnd>;
  },
  send: (now: boolean) => void,
  onToast?: ToastFn,
) {
  /** The send asked for (`now` or not) while the dictation ends. */
  const [waiting, setWaiting] = useState<{ now: boolean } | null>(null);
  /** The dictated text is in: the draft goes on the render that shows it. */
  const [landed, setLanded] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const { status, stop } = voice;
  const submit = useCallback(
    (now: boolean) => {
      if (waiting) return;
      if (status === "idle" || status === "starting") {
        // Not listening yet: nothing to wait for.
        if (status === "starting") void stop();
        send(now);
        return;
      }
      setWaiting({ now });
      setLanded(false);
      // Quiet while this input is there to tell a failure; gone (a request
      // took its place), the voice hook's own error shows it.
      let hookTells = false;
      const quiet = () => {
        hookTells = !aliveRef.current;
        return !hookTells;
      };
      void stop({ quiet }).then((end) => {
        if (end.ok) {
          setLanded(true);
          return;
        }
        // Told here, not on a later render: a request arriving meanwhile
        // unmounts this input before any effect of it runs.
        setWaiting(null);
        if (!hookTells) {
          onToast?.("error", `${DICTATION_FAILED} (${end.error})`);
        }
      });
    },
    [waiting, status, stop, send, onToast],
  );

  // The dictated text reaches the draft before the dictation reads idle (it
  // lands, then the status falls back): the render that sees both idle and
  // the outcome holds the full draft.
  useEffect(() => {
    if (!waiting || !landed || status !== "idle") return;
    setWaiting(null);
    setLanded(false);
    send(waiting.now);
  }, [waiting, landed, status, send]);

  return { waiting: waiting !== null, submit };
}
