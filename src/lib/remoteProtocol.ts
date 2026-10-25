/**
 * The messages on the phone's socket to Arkadia (see src-tauri `remote`),
 * shared by the web page (`src/mobile/remote.ts`) and the iPhone app
 * (`iphone/`), so both speak exactly what the server reads.
 */

import type { RemoteAction } from "@/lib/remoteActions";
import type { RemoteSnapshot } from "@/lib/remoteSnapshot";
import type { WakeRelay } from "@/mobile/wake";
import type { RenderPayload } from "@/types";

export type ClientMsg =
  | { t: "watch"; pane: string | null }
  | { t: "input"; pane: string; data: string }
  /** Writes spaced on the PC itself, so the PTY never merges them into a
   *  paste (REVIEW.md « Rafale de touches »). */
  | { t: "inputs"; pane: string; parts: string[]; gap_ms: number }
  | { t: "resize"; pane: string; cols: number; rows: number }
  | { t: "scroll"; pane: string; delta: number }
  | { t: "wheel"; pane: string; col: number; row: number; button: 64 | 65 }
  | { t: "click"; pane: string; col: number; row: number }
  | { t: "action"; id: number; action: RemoteAction }
  | { t: "sessions"; id: number }
  | { t: "search"; id: number; query: string }
  | { t: "conv"; id: number; pane: string; generation: number; have: number }
  /** The picker's recent photos or downloads on the PC. */
  | { t: "files"; id: number; source: FileSource; limit: number }
  /** The last code block Claude wrote in the pane. */
  | { t: "code"; id: number; pane: string }
  /** The iPhone app's push token, for the panes it drives. */
  | { t: "push"; token: string }
  /** The Live Activity's push token; null once the app ended it. */
  | { t: "activity"; token: string | null };

export type FileSource = "photos" | "downloads";

/** One file of `files` (src-tauri `photos::FileEntry`). */
export interface RemoteFile {
  /** Absolute path: what gets typed into the prompt. */
  path: string;
  name: string;
  /** Last write, ms since the epoch. */
  mtime: number;
  size: number;
  is_dir: boolean;
  /** A still the `/thumb` route can preview. */
  is_image: boolean;
}

export type ServerMsg =
  | { t: "state"; state: RemoteSnapshot }
  | { t: "frame"; frame: RenderPayload }
  | { t: "reply"; id: number; result?: unknown; error?: string }
  | { t: "event"; name: string; payload: unknown }
  | ({ t: "wake" } & WakeRelay)
  /** The panes the iPhone drives (src-tauri `remote::phone`). */
  | { t: "follow"; panes: string[] }
  | { t: "error"; message: string };
