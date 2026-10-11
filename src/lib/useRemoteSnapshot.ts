import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildRemoteSnapshot,
  type RemoteSnapshotInput,
} from "@/lib/remoteSnapshot";

/** Batches bursts of changes (a working pane retitles itself many times a second). */
const PUBLISH_EVERY_MS = 150;

/**
 * Keeps the phone companion server's copy of the desktop current. Throttled,
 * not debounced: a busy pane's spinner keeps `tabs` changing, which would
 * postpone a debounced publish forever. Unchanged snapshots are not resent.
 * `input` must be memoized: a new object means "something changed".
 */
export function useRemoteSnapshot(
  enabled: boolean,
  input: RemoteSnapshotInput,
): void {
  const pending = useRef<string | null>(null);
  const sent = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    pending.current = JSON.stringify(buildRemoteSnapshot(input));
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const snapshot = pending.current;
      if (!snapshot || snapshot === sent.current) return;
      sent.current = snapshot;
      void invoke("remote_publish_state", { snapshot }).catch(() => {});
    }, PUBLISH_EVERY_MS);
  }, [enabled, input]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      // A hot reload re-runs the effects with the refs kept: a stale id
      // here would block every later publish.
      timer.current = null;
    },
    [],
  );
}
