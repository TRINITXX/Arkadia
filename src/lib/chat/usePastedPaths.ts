import { useCallback } from "react";
import { backendInvoke } from "@/lib/bridge";
import { attachPaths, pastedPaths } from "@/lib/chat/chatAttachments";
import type { ChatDraft } from "@/lib/chat/chatDrafts";

/** True when the file or folder exists, as written (`path_exists`): never a
 *  file to create, which `resolve_path_in_pane` also answers for. */
function exists(path: string): Promise<boolean> {
  return backendInvoke<boolean>("path_exists", { path }).catch(() => false);
}

/**
 * Text pasted in the chat's input that is only paths (`pastedPaths`): cards
 * above the input once they all exist on disk, else the text lands where the
 * caret was, as any paste. Returns true when it took the paste.
 */
export function usePastedPaths(
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>,
) {
  return useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>): boolean => {
      const text = e.clipboardData.getData("text/plain");
      const paths = pastedPaths(text);
      if (!paths) return false;
      e.preventDefault();
      const area = e.currentTarget;
      const start = area.selectionStart;
      const end = area.selectionEnd;
      void Promise.all(paths.map(exists)).then((found) => {
        // The input gone meanwhile (its pane closed, `dropDraft`): writing
        // would bring its draft back.
        if (!area.isConnected) return;
        if (found.every(Boolean)) {
          onDraft((d) => attachPaths(d, paths));
          return;
        }
        // Not files after all: the paste as typed, on the draft of now.
        const typed = text.replace(/\r\n/g, "\n");
        let caret = start + typed.length;
        onDraft((d) => {
          const at = Math.min(start, d.text.length);
          const to = Math.min(Math.max(end, at), d.text.length);
          caret = at + typed.length;
          return { ...d, text: d.text.slice(0, at) + typed + d.text.slice(to) };
        });
        // Once the input shows it: React setting its value moved the caret.
        requestAnimationFrame(() => {
          if (area.isConnected) area.setSelectionRange(caret, caret);
        });
      });
      return true;
    },
    [onDraft],
  );
}
