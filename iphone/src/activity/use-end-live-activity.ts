import { useEffect } from "react";
import { claudeDots } from "~/activity/claude-dots";

/**
 * No Live Activity any more, Lock Screen nor Dynamic Island (Alexis's
 * choice of 04/11/2026: the notifications are enough). Ends the one an
 * earlier version left running; the PC no longer pushes to it.
 */
export function useEndLiveActivity() {
  useEffect(() => {
    try {
      for (const running of claudeDots.getInstances())
        void running.end("immediate").catch(() => {});
    } catch {
      // Live Activities turned off for Arkadia in Settings: none to end.
    }
  }, []);
}
