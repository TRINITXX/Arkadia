import { createContext, useContext } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";

/**
 * The chat's lightbox, for what the column draws without an `onOpen` passed
 * down (a work group's thumbnails of the images Claude read). Null outside a
 * chat column.
 */
export const ChatLightboxContext = createContext<
  ((content: LightboxContent) => void) | null
>(null);

export function useChatLightbox(): ((content: LightboxContent) => void) | null {
  return useContext(ChatLightboxContext);
}
