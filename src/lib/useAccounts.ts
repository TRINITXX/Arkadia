import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AccountsState } from "@/lib/accounts";

/** Local file reads only (registry + usage cache): cheap enough to poll. */
const REFRESH_MS = 15_000;

/**
 * Claude accounts: the list with each one's usage, the one new tabs open on,
 * and the actions of the accounts panel. Every action re-reads the state.
 */
export function useAccounts() {
  const [state, setState] = useState<AccountsState | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await invoke<AccountsState>("accounts_state"));
    } catch {
      // Older backend without accounts: the UI simply shows none.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const setCurrent = useCallback(
    async (id: string) => {
      await invoke("account_set_current", { id }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  /** Registers a new account (made current); resolves to its id. */
  const add = useCallback(async (): Promise<string | null> => {
    const id = await invoke<string>("account_add").catch(() => null);
    await refresh();
    return id;
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await invoke("account_remove", { id }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, patch: { label?: string; color?: string }) => {
      await invoke("account_update", { id, ...patch }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  return { state, refresh, setCurrent, add, remove, update };
}
