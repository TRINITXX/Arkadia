import { useEffect } from "react";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";

/** The tab the app shows, reopened at the next launch (`useReopenLastTab`). */
export const LAST_TAB_KEY = "arkadia-last-tab";
const OPENING_KEY = "arkadia-opening-tab";
/** Shown this long with the app still up: the tab opens fine. */
const SETTLED_MS = 6000;

/** A tab that broke: the next launch opens on Projets, not on it. */
export function forgetLastTab(): void {
  void SecureStore.deleteItemAsync(LAST_TAB_KEY).catch(() => {});
}

/**
 * Marks a tab while it opens. The app dying meanwhile (a native crash, which
 * no JS handler sees) leaves the mark: the next launch doesn't reopen that
 * tab, so a tab that crashes at open never locks the app in a loop (the
 * chats of 02/11/2026 did). The app gone to the background proves it opened.
 */
export function useOpeningMark(tabId: string | null) {
  useEffect(() => {
    if (!tabId) return;
    void SecureStore.setItemAsync(OPENING_KEY, tabId).catch(() => {});
    // Only its own mark: a tab opened over this one keeps its.
    const clear = () =>
      void SecureStore.getItemAsync(OPENING_KEY)
        .then((marked) =>
          marked === tabId
            ? SecureStore.deleteItemAsync(OPENING_KEY)
            : undefined,
        )
        .catch(() => {});
    const timer = setTimeout(clear, SETTLED_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") clear();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
      clear();
    };
  }, [tabId]);
}

/** The tab the app died opening at its last launch, once; null: none. */
export async function takeOpeningMark(): Promise<string | null> {
  const tab = await SecureStore.getItemAsync(OPENING_KEY).catch(() => null);
  if (tab) await SecureStore.deleteItemAsync(OPENING_KEY).catch(() => {});
  return tab;
}
