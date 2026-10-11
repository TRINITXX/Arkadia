import { useCallback, useState } from "react";
import type { RemoteAction } from "@/lib/remoteActions";
import { showNotice } from "@/mobile/notice";
import { act } from "@/mobile/remote";

/**
 * Runs a desktop action from the phone. When it yields a tab (new tab,
 * toolbar button, resumed session), `onOpenTab` shows it; a failure shows a
 * notice. Resolves to whether it worked.
 */
export function useRemoteAction(onOpenTab: (tabId: string) => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action: RemoteAction): Promise<boolean> => {
      setBusy(true);
      try {
        const result = await act(action);
        if (result.tabId) onOpenTab(result.tabId);
        return true;
      } catch (e) {
        showNotice(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onOpenTab],
  );
  return { busy, run };
}
