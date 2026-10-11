/**
 * What the phone companion asks the desktop window to do: everything that
 * changes desktop-owned state (tabs, accounts, settings) or runs a button.
 * Sent by the phone, relayed by the Rust server as `remote-action`, executed
 * by `App` with the same functions as the desktop UI.
 */

import type { ClaudeSession } from "@/lib/sessionsIndex";
import { findItem } from "@/lib/toolbarTree";
import type { ActionButton, ToolbarButton } from "@/types";

export type RemoteAction =
  | { kind: "newTab"; projectId: string }
  | { kind: "closeTab"; tabId: string }
  /** Toolbar button, in `paneId` when it sits on a bare prompt, else a new tab. */
  | {
      kind: "runButton";
      projectId: string;
      paneId: string | null;
      buttonId: string;
    }
  | { kind: "promptButton"; paneId: string; buttonId: string }
  | { kind: "resume"; session: ClaudeSession }
  | { kind: "setAccount"; accountId: string }
  | {
      kind: "updateAccount";
      accountId: string;
      label?: string;
      color?: string;
    }
  | { kind: "autoSwitch"; on: boolean };

/** `tabId`: the tab the phone should open next (new or reused). */
export interface RemoteActionResult {
  tabId?: string;
  error?: string;
}

/** `remote-action` event payload (see src-tauri `remote::server`). */
export interface RelayedAction {
  client: number;
  id: number;
  action: RemoteAction;
}

/** The runnable button `id` in a toolbar tree, or null (missing, or a folder). */
export function actionButton(
  buttons: ToolbarButton[],
  id: string,
): ActionButton | null {
  const item = findItem(buttons, id)?.item;
  return item?.kind === "action" ? item : null;
}
