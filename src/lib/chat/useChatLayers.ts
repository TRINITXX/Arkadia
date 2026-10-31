import { createContext, useContext, useEffect, useRef } from "react";
import type { ChatLayers } from "@/lib/chat/chatLayers";

/** The pane's layers, provided by `ChatView`. */
export const ChatLayersContext = createContext<ChatLayers | null>(null);

/** The layers of the pane around; null outside one (a preview). */
export function useChatLayers(): ChatLayers | null {
  return useContext(ChatLayersContext);
}

/**
 * Counts a layer as open in `layers` while `open`: the pane's Esc calls
 * `close` (the latest given) before it would reach Claude.
 */
export function useLayer(
  layers: ChatLayers | null,
  open: boolean,
  close: () => void,
): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open || !layers) return;
    return layers.open(() => closeRef.current());
  }, [open, layers]);
}

/** `useLayer` in the pane around: a menu, list or sheet of the chat. */
export function useChatLayer(open: boolean, close: () => void): void {
  useLayer(useChatLayers(), open, close);
}
