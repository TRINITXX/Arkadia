import type { ReactNode } from "react";
import type { ChatItem, Subagent } from "@/lib/chat/chatState";
import type { FeedRow } from "@/lib/chat/phoneFeed";
import type { ChatActions } from "~/chat/use-chat";

/** What a row opens over the feed: its whole content in a sheet. A reply's
 *  bulb opens `thoughts`, its wrench `activity` (« Récit »); a pasted
 *  text's tag in the user's message, `paste`. */
export type FeedSheetKind =
  | "activity"
  | "thoughts"
  | "plan"
  | "command"
  | "bash"
  | "paste";

export interface FeedSheetRef {
  kind: FeedSheetKind;
  /** The row's key: the sheet follows the row as the chat goes on. */
  key: string;
  /** The row as it opened: shown while it's gone from the feed (a live
   *  thought gone behind its reply's bulb), until the sheet closes. */
  row: FeedRow;
  /** `paste`: the text its tag stands for. */
  paste?: string;
}

/**
 * What every row of a feed shares, one identity per feed: a row re-renders
 * for its own items, never because the chat moved elsewhere.
 */
export interface FeedEnv {
  chatId: string;
  /** The chat's folder: tool lines name files from it (`shortPath`). */
  cwd: string | null;
  actions: ChatActions;
  onChoose: (text: string) => void;
  /** The chat's own feed: its marks and stops act; a subagent's only reads. */
  acts: boolean;
  open: (sheet: FeedSheetRef) => void;
  /** The pencil on the user's messages; absent: none. */
  edit?: (item: Extract<ChatItem, { kind: "user" }>) => void;
}

/**
 * A subagent's conversation, drawn by the chat's feed inside the sheet that
 * opened it (iOS stacks a sheet only from the one under it). Passed down so
 * the list and the subagent's sheet (a list itself) don't import each other.
 */
export type AgentSheetRender = (
  agent: Subagent | null,
  visible: boolean,
  onClose: () => void,
) => ReactNode;
