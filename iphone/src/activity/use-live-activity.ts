import { useEffect, useMemo, useRef } from "react";
import type { LiveActivity } from "expo-widgets";
import { followRows } from "@/lib/followRows";
import type { RemoteSnapshot } from "@/lib/remoteSnapshot";
import { claudeDots, type ClaudeDotsProps } from "~/activity/claude-dots";
import { registerActivityToken, useFollowedPanes } from "~/remote/connection";

/**
 * Keeps the Live Activity in step with the tabs driven from the iPhone: it
 * starts with the first one (iOS starts activities only from an app in
 * front), follows them while the app is open, and ends with the last. Its
 * push token goes to the PC, which takes over in the background
 * (src-tauri `remote::activity`).
 */
export function useLiveActivity(snapshot: RemoteSnapshot | null) {
  const panes = useFollowedPanes();
  // As text: the snapshot changes often, the rows much less.
  const rowsJson = useMemo(
    () =>
      snapshot && panes
        ? JSON.stringify(followRows(snapshot, new Set(panes)))
        : null,
    [snapshot, panes],
  );
  const activity = useRef<LiveActivity<ClaudeDotsProps> | null>(null);

  // One left running by an earlier launch: carry on with it.
  useEffect(() => {
    const running = claudeDots.getInstances()[0] ?? null;
    activity.current = running;
    if (running)
      void running.getPushToken().then((t) => registerActivityToken(t));
    else registerActivityToken(null);
  }, []);

  useEffect(() => {
    // Until the desktop's state and the followed panes both arrived (two
    // messages, in any order), nothing is known: leave it as is.
    if (rowsJson === null) return;
    const tabs = JSON.parse(rowsJson) as ClaudeDotsProps["tabs"];
    const current = activity.current;
    if (tabs.length === 0) {
      if (!current) return;
      activity.current = null;
      registerActivityToken(null);
      void current.end("immediate");
      return;
    }
    if (current) {
      void current.update({ tabs });
      return;
    }
    try {
      const started = claudeDots.start({ tabs }, "arkadia://");
      activity.current = started;
      started.addPushTokenListener((e) => registerActivityToken(e.pushToken));
      void started.getPushToken().then((t) => t && registerActivityToken(t));
    } catch {
      // Live Activities turned off for Arkadia in Settings: notifications only.
    }
  }, [rowsJson]);
}
