import { useEffect, useState } from "react";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import type { RemoteSnapshot } from "@/lib/remoteSnapshot";
import { registerPushToken } from "~/remote/connection";
import { allProjects } from "~/remote/snapshot";

// In front, a push for another tab still shows as a banner (the PC sends
// none for the tab on screen).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The tab holding `paneId`, if the desktop still has it. */
function tabOfPane(snapshot: RemoteSnapshot, paneId: string): string | null {
  for (const project of allProjects(snapshot))
    for (const tab of project.tabs)
      if (tab.panes.some((p) => p.id === paneId)) return tab.id;
  return null;
}

/**
 * Hands the PC the app's push token (it rings only for the tabs driven from
 * the iPhone, src-tauri `remote::phone`), and opens the tab of a tapped
 * notification once the desktop's snapshot knows it.
 */
export function usePushNotifications(snapshot: RemoteSnapshot | null) {
  const [pendingPane, setPendingPane] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as
        | string
        | undefined;
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
      registerPushToken(data);
    })().catch(() => {
      // No token (simulator, no network): the app works without pushes.
    });
  }, []);

  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const pane = response?.notification.request.content.data?.paneId;
    if (typeof pane === "string") setPendingPane(pane);
  }, [response]);

  useEffect(() => {
    if (!pendingPane || !snapshot) return;
    const tabId = tabOfPane(snapshot, pendingPane);
    setPendingPane(null);
    if (tabId) router.push({ pathname: "/tab/[id]", params: { id: tabId } });
  }, [pendingPane, snapshot]);
}
