/**
 * How views shared by the desktop and the phone companion reach the backend:
 * Tauri IPC on the desktop; the phone swaps in its socket (`setBridge`) before
 * rendering. Only what the modern conversation view needs goes through here.
 */

import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { openLink } from "@/lib/openLink";

/**
 * The backend could not be reached (the phone lost its connection): what a
 * view already shows stays as it is, unlike a real "no such conversation".
 */
export class TransientError extends Error {}

export interface Bridge {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(
    event: string,
    handler: (e: { payload: T }) => void,
  ): Promise<() => void>;
  /** Opens a web link: a claude.ai artifact in the panel, the rest outside the app. */
  openUrl(url: string): Promise<void>;
  /** Where a `<video>` streams a video file of the PC from, in byte ranges. */
  mediaUrl(path: string): string;
}

let bridge: Bridge = {
  invoke: (cmd, args) => tauriInvoke(cmd, args),
  listen: (event, handler) => tauriListen(event, handler),
  openUrl: (url) => openLink(url),
  // The backend's `arkmedia` protocol (`src-tauri/src/media.rs`).
  mediaUrl: (path) =>
    `${convertFileSrc("", "arkmedia")}?path=${encodeURIComponent(path)}`,
};

export function setBridge(next: Bridge): void {
  bridge = next;
}

export function backendInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return bridge.invoke<T>(cmd, args);
}

export function backendListen<T>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<() => void> {
  return bridge.listen(event, handler);
}

export function openUrl(url: string): Promise<void> {
  return bridge.openUrl(url);
}

export function mediaUrl(path: string): string {
  return bridge.mediaUrl(path);
}
