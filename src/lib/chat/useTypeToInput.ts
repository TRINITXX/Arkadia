import { useEffect } from "react";
import { useAnyOverlayOpen } from "@/lib/overlays";

/** Where typed keys belong already: a field, a menu, a layer of the chat. */
function keepsKeys(el: Element, key: string): boolean {
  if (el.closest("input, textarea, select, [contenteditable='true']"))
    return true;
  if (el.closest("[role='menu'], [role='dialog'], .chat-menu")) return true;
  // Space presses a focused button.
  return (
    key === " " && el.closest("button, [role='button'], [role='link']") !== null
  );
}

/**
 * In the active chat pane, a printable key typed while the focus is in no
 * field (after a click in the conversation) lands in the input. Never with
 * Ctrl, Alt or Meta, nor while a layer is open (viewer, settings, the
 * subagents' drawer or sheet), nor when the focus is in another pane.
 */
export function useTypeToInput(
  areaRef: React.RefObject<HTMLTextAreaElement | null>,
  type: (text: string) => void,
  enabled: boolean,
): void {
  const overlayOpen = useAnyOverlayOpen();
  const armed = enabled && !overlayOpen;
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      const area = areaRef.current;
      const root = area?.closest(".chat-root");
      if (!area || !root) return;
      const focused = document.activeElement;
      if (focused === area) return;
      if (focused && focused !== document.body) {
        if (!root.contains(focused) || keepsKeys(focused, e.key)) return;
      }
      if (root.querySelector(".chat-sheet, .chat-drawer")) return;
      e.preventDefault();
      area.focus();
      type(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, areaRef, type]);
}
