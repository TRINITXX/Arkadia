import { useEffect, useRef } from "react";

/**
 * A chat asleep wakes on the first change to its input (a key, a paste, a
 * dictation that lands): its Claude Code starts while the user goes on
 * typing, and is up by the time the message goes. The input found at mount
 * (a draft kept on disk, another pane's) wakes nothing. `input`: the
 * desktop's draft, the iPhone's text, compared by identity.
 */
export function useWakeOnInput(
  asleep: boolean,
  input: unknown,
  onWake?: () => void,
): void {
  const seen = useRef(input);
  useEffect(() => {
    if (input === seen.current) return;
    seen.current = input;
    if (asleep) onWake?.();
  }, [asleep, input, onWake]);
}
