import { useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { router, useGlobalSearchParams, useSegments } from "expo-router";
import type { RemoteSnapshot } from "@/lib/remoteSnapshot";
import { findTab } from "~/remote/snapshot";

const LAST_TAB_KEY = "arkadia-last-tab";

/**
 * At launch, reopens the terminal tab Alexis left the app on, even when iOS
 * closed the app meanwhile (asked on 28/10/2026). Left on a list, or the tab
 * closed on the PC since: the app opens on Projets. A notification tapped to
 * launch the app opens its own tab instead.
 */
export function useReopenLastTab(snapshot: RemoteSnapshot | null) {
  // Segments, not the address: the bar's three lists all live at "/".
  const segments = useSegments();
  const place = segments.join("/");
  const { id } = useGlobalSearchParams<{ id?: string }>();
  const openTab = segments[0] === "tab" && typeof id === "string" ? id : null;
  // Undefined until read: the start screen must not overwrite it first.
  const [lastTab, setLastTab] = useState<string | null | undefined>();
  // Until then, only the reopening decides: the list under it is no choice.
  const [settled, setSettled] = useState(false);
  const startPlace = useRef<string | null>(null);

  useEffect(() => {
    void SecureStore.getItemAsync(LAST_TAB_KEY)
      .catch(() => null)
      .then(setLastTab);
  }, []);

  useEffect(() => {
    if (settled || lastTab === undefined) return;
    startPlace.current ??= place;
    // Nothing to reopen, or Alexis went elsewhere while the PC answered.
    if (!lastTab || place !== startPlace.current) {
      setSettled(true);
      return;
    }
    if (!snapshot) return;
    setSettled(true);
    if (Notifications.getLastNotificationResponse()) return;
    if (findTab(snapshot, lastTab))
      router.push({ pathname: "/tab/[id]", params: { id: lastTab } });
  }, [settled, lastTab, snapshot, place]);

  const onPicker = segments[0] === "pick";
  useEffect(() => {
    // The file picker opens over a tab: still that tab.
    if (!settled || onPicker) return;
    const write = openTab
      ? SecureStore.setItemAsync(LAST_TAB_KEY, openTab)
      : SecureStore.deleteItemAsync(LAST_TAB_KEY);
    void write.catch(() => {});
  }, [settled, onPicker, openTab]);
}
