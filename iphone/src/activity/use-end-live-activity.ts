import { useEffect } from "react";
import { claudeDots } from "~/activity/claude-dots";
import { registerActivityToken } from "~/remote/connection";

/**
 * No Live Activity any more, Lock Screen nor Dynamic Island (Alexis's
 * choice of 04/11/2026: the notifications are enough). Ends the one an
 * earlier version left running, and tells the PC it has no token to push
 * to, now and on every reconnection (src-tauri `remote::activity`).
 */
export function useEndLiveActivity() {
  useEffect(() => {
    registerActivityToken(null);
    try {
      for (const running of claudeDots.getInstances())
        void running.end("immediate").catch(() => {});
    } catch {
      // Live Activities turned off for Arkadia in Settings: none to end.
    }
  }, []);
}
