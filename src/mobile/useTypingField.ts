import { useCallback, useRef } from "react";
import { keyEventToBytes } from "@/lib/keymap";
import { typingDelta } from "@/mobile/typing";

const decoder = new TextDecoder();

/**
 * The hidden text field the phone types through. Text reaches the prompt as
 * the field changes (`typingDelta`); keys that are not text (Enter, arrows,
 * Esc, Tab, Ctrl+…, from a physical keyboard) go straight to the terminal.
 */
export function useTypingField(send: (data: string) => boolean) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const sent = useRef("");

  /** Starts over: what the field held no longer matches the prompt. */
  const reset = useCallback(() => {
    sent.current = "";
    if (ref.current) ref.current.value = "";
  }, []);

  const onInput = useCallback(() => {
    const now = ref.current?.value ?? "";
    // A keyboard whose Enter skipped keydown leaves a line break in the field:
    // it still means "submit".
    if (now === `${sent.current}\n`) {
      send("\r");
      reset();
      return;
    }
    const delta = typingDelta(sent.current, now);
    sent.current = now;
    // Dropped while offline: the prompt never got it, so the field and the
    // prompt no longer match. Start over rather than erase the wrong text later.
    if (delta && !send(delta)) reset();
  }, [send, reset]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Backspace" && !e.ctrlKey) {
        // Erasing past the field's start changes nothing in it, so no input
        // event would carry it: send it here.
        if (e.currentTarget.value === "") {
          e.preventDefault();
          send("\x7f");
        }
        return;
      }
      const isText =
        e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
      // Ctrl+V on the old PC: let the browser paste into the field.
      const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v";
      if (isText || isPaste) return;
      const bytes = keyEventToBytes(e);
      if (!bytes) return;
      e.preventDefault();
      send(decoder.decode(bytes));
      reset();
    },
    [send, reset],
  );

  return { ref, onInput, onKeyDown, reset };
}
