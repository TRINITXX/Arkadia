import { useCallback, useEffect, useRef, useState } from "react";
import { lastCodeBlock } from "@/lib/chat/chatCodeBlock";
import type { ChatItem } from "@/lib/chat/chatState";
import { copiedCodeMessage } from "@/lib/codeCopy";

/** How long the copy button holds its ✓ (the terminal rail's `COPIED_MS`). */
const COPIED_MS = 1200;

/**
 * The terminal rail's « Copier le dernier bloc de code de Claude », for the
 * chat: same toasts (the block is off screen, so the toast echoes its first
 * line), same ✓ on the button for a moment.
 */
export function useCopyLastCode(
  items: ChatItem[],
  onToast?: (level: "info" | "error", message: string) => void,
): { copied: boolean; copy: () => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async () => {
    const code = lastCodeBlock(items);
    if (!code) {
      onToast?.("error", "Aucun bloc de code récent dans cette conversation");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
    } catch (e) {
      onToast?.("error", `Copie impossible : ${String(e)}`);
      return;
    }
    onToast?.("info", copiedCodeMessage(code));
    // The input went away meanwhile (a request took its place).
    if (!mountedRef.current) return;
    setCopied(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }, [items, onToast]);

  return { copied, copy };
}
