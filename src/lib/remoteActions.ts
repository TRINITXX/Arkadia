/**
 * What the phone companion asks the desktop window to do: everything that
 * changes desktop-owned state (tabs, accounts, settings) or runs a button.
 * Sent by the phone, relayed by the Rust server as `remote-action`, executed
 * by `App` with the same functions as the desktop UI.
 */

import type {
  ChatCommand,
  RewindPoint,
  SessionChoice,
} from "@/lib/chat/chatProtocol";
import type { McpAction, PagePanel } from "@/lib/chat/chatSlash";
import type { RewindMode } from "@/lib/chat/useSlashActions";
import type { ClaudeSession } from "@/lib/sessionsIndex";
import { findItem } from "@/lib/toolbarTree";
import type { ActionButton, ToolbarButton } from "@/types";

/**
 * A chat command from the phone, `chatId` filled by the desktop. `paneId`
 * only on what the user does (writes, answers, stops…): it makes the phone
 * drive the tab (`remote::phone`), a mere read never does.
 */
export type PhoneChatCommand = ChatCommand extends infer C
  ? C extends { chatId: string }
    ? Omit<C, "chatId" | "to">
    : never
  : never;

export type RemoteAction =
  /** `chat`: as `runButton`'s, the new tab opens on a chat asleep. */
  | { kind: "newTab"; projectId: string; chat?: boolean }
  | { kind: "closeTab"; tabId: string }
  /** Toolbar button, in `paneId` when it sits on a bare prompt, else a new tab. */
  | {
      kind: "runButton";
      projectId: string;
      paneId: string | null;
      buttonId: string;
      /** The client shows chats (the iPhone app): Claude opens as one, as
       *  on the desktop. The old web page reads terminals only. */
      chat?: boolean;
    }
  | { kind: "promptButton"; paneId: string; buttonId: string }
  /** `chat`: as `runButton`'s. */
  | { kind: "resume"; session: ClaudeSession; chat?: boolean }
  | { kind: "setAccount"; accountId: string }
  | {
      kind: "updateAccount";
      accountId: string;
      label?: string;
      color?: string;
    }
  | { kind: "autoSwitch"; on: boolean }
  /**
   * The phone opens a chat pane: its life replayed to that phone. `restart`:
   * one ended starts again on its session (« Reprendre »); without it the
   * phone only catches up (`closed` when it isn't running).
   */
  | { kind: "chatOpen"; chatId: string; restart: boolean }
  | {
      kind: "chatCommand";
      chatId: string;
      paneId?: string;
      command: PhoneChatCommand;
    }
  /** Chat ⇄ terminal, as the desktop toolbar's switch. */
  | { kind: "chatToggle"; paneId: string }
  /**
   * The desktop's /resume, /rewind and /mcp for a chat the phone shows, with
   * the desktop's rules (`slashActions`, `mcpAction`): the lists to pick
   * from, then the pick. `paneId` on a pick: the phone drives the tab.
   */
  | { kind: "chatSessions"; chatId: string }
  | { kind: "chatResume"; chatId: string; paneId: string; sessionId: string }
  | { kind: "chatRewindPoints"; chatId: string }
  | {
      kind: "chatRewind";
      chatId: string;
      paneId: string;
      /** The user message to go back before (`RewindPoint.uuid`). */
      before: string;
      mode: RewindMode;
    }
  | {
      kind: "chatMcp";
      chatId: string;
      paneId: string;
      server: string;
      action: McpAction;
    };

/** `tabId`: the tab the phone should open next (new or reused). */
export interface RemoteActionResult {
  tabId?: string;
  error?: string;
  /** A prompt button of a chat pane that types without sending: its text,
   *  for the phone's own input (the chat's input lives on the phone). */
  text?: string;
  /** `chatSessions`: the folder's sessions, those open elsewhere marked. */
  sessions?: SessionChoice[];
  /** `chatRewindPoints`: the user's messages to go back before. */
  points?: RewindPoint[];
  /** `chatMcp`: a sign-in's page, opened in the PC's browser. */
  authUrl?: string;
  /** A chat's prompt button for /resume, /rewind or /mcp: the phone's sheet. */
  panel?: { name: PagePanel; query: string };
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
