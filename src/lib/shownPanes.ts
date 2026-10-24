/**
 * Tells the Rust side which panes this webview shows right now.
 *
 * Every pane streams its full screen at up to 60 Hz; a pane nobody shows is
 * slowed to 2 Hz on the Rust side (`pane_viewers.rs`). Ten busy sessions in
 * hidden tabs otherwise sent ~94 frames of ~116 KB a second to the page, which
 * fell behind until the watchdog reloaded it (measured 24/10/2026).
 *
 * Holders are counted per pane; the whole set is sent once per microtask, so a
 * tab switch that unmounts one pane and mounts another costs a single call.
 */

import { invoke } from "@tauri-apps/api/core";

type Send = (panes: string[]) => void;

let send: Send = (panes) => {
  void invoke("set_shown_panes", { panes }).catch(() => {});
};

const holders = new Map<string, number>();
let queued = false;

function queueSync(): void {
  if (queued) return;
  queued = true;
  void Promise.resolve().then(() => {
    queued = false;
    send([...holders.keys()]);
  });
}

/** Marks `paneId` as on screen until the returned function is called. */
export function holdPaneShown(paneId: string): () => void {
  const n = holders.get(paneId) ?? 0;
  holders.set(paneId, n + 1);
  if (n === 0) queueSync();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holders.get(paneId) ?? 1) - 1;
    if (left > 0) {
      holders.set(paneId, left);
      return;
    }
    holders.delete(paneId);
    queueSync();
  };
}

/** Test hook: swap the sender and forget every holder. */
export function _resetShownPanesForTests(s: Send): void {
  holders.clear();
  queued = false;
  send = s;
}
