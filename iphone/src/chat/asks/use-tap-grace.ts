import { useCallback, useEffect, useRef } from "react";

/**
 * Taps this soon after a panel shows, or after a tap it ignored, were meant
 * for what it replaced (the composer's send, a row of the feed): they answer
 * nothing. The desktop's `KEY_GRACE_MS`, for fingers.
 */
const TAP_GRACE_MS = 600;

/**
 * Wraps a panel's answers: ignored in the grace after it mounts (panels are
 * keyed by their request), and a tapper who goes on stays ignored until a
 * pause.
 */
export function useTapGrace() {
  const quietSince = useRef(Number.POSITIVE_INFINITY);
  useEffect(() => {
    quietSince.current = Date.now();
  }, []);
  return useCallback(
    (answer: () => void) => () => {
      const now = Date.now();
      if (now - quietSince.current < TAP_GRACE_MS) {
        quietSince.current = now;
        return;
      }
      answer();
    },
    [],
  );
}
