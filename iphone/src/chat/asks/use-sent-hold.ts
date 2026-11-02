import { useEffect, useState } from "react";

/**
 * An answer takes a moment to reach the PC and come back as the request
 * resolved: meanwhile its panel dims and takes no more taps. Past this, an
 * answer lost on the way, the panel takes taps again.
 */
const SENT_HOLD_MS = 4000;

/** The request just answered (`hold`), until the PC replaces it or the hold ends. */
export function useSentHold() {
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setSent(null), SENT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [sent]);
  return { sent, hold: setSent };
}
