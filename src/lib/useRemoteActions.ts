import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  RelayedAction,
  RemoteAction,
  RemoteActionResult,
} from "@/lib/remoteActions";
import { subscribeStable } from "@/lib/tauriEvents";

/**
 * Runs the phone companion's actions (`remote-action`) and sends each result
 * back to the phone that asked. `handle` is read through a ref: it changes
 * with the desktop state, the subscription must not.
 */
export function useRemoteActions(
  handle: (action: RemoteAction) => Promise<RemoteActionResult>,
): void {
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  useEffect(
    () =>
      subscribeStable<RelayedAction>(listen, "remote-action", (relayed) => {
        void handleRef
          .current(relayed.action)
          .catch((e: unknown) => ({ error: String(e) }))
          .then((result) =>
            invoke("remote_reply", {
              client: relayed.client,
              id: relayed.id,
              result,
            }),
          )
          .catch(() => {});
      }),
    [],
  );
}
