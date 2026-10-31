import { attachPaths } from "@/lib/chat/chatAttachments";
import { setDraft } from "@/lib/chat/chatDrafts";

/**
 * Files dropped from Explorer on a chat pane (`App`'s drag & drop): cards
 * above the pane's input (`chatAttachments`), its text untouched, nothing
 * sent. With no input on screen (a request takes its place) they wait in the
 * draft. Only the active pane's input takes the focus.
 */
export function dropPathsInChat(
  paneId: string,
  paths: string[],
  area: HTMLTextAreaElement | null,
  focus: boolean,
): void {
  setDraft(paneId, (d) => attachPaths(d, paths));
  if (area && focus) area.focus();
}
