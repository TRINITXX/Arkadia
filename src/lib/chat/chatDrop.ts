import { setDraft } from "@/lib/chat/chatDrafts";
import { insertPathsInDraft } from "@/lib/pickerPrompt";

/**
 * Files dropped from Explorer on a chat pane (`App`'s drag & drop): their
 * quoted paths go into the pane's draft at the input's caret, as the file
 * picker puts them (`useDraftFilePicker`), and nothing is sent. With no input
 * on screen (a request takes its place) they go at the draft's end. Only the
 * active pane's input takes the focus.
 */
export function dropPathsInChat(
  paneId: string,
  paths: string[],
  area: HTMLTextAreaElement | null,
  focus: boolean,
): void {
  // The selection survives the blur: the caret is where the user left it.
  const caret = area
    ? { start: area.selectionStart, end: area.selectionEnd }
    : null;
  let after = 0;
  setDraft(paneId, (d) => {
    const next = insertPathsInDraft(d.text, paths, caret);
    after = next.caret;
    return { ...d, text: next.text };
  });
  if (!area) return;
  // Once the input shows the new text: React setting its value moved the
  // caret to the end.
  requestAnimationFrame(() => {
    if (!area.isConnected) return;
    if (focus) area.focus();
    area.setSelectionRange(after, after);
  });
}
