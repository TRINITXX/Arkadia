import { createContext, useContext } from "react";
import type { PreviewAnchor } from "@/components/ImageHoverPreview";

/**
 * Where an image path of the markdown reports the pointer, for a preview
 * card as the terminal shows one (`useImageHoverPreview`): the path and its
 * box on entering, null on leaving. Only the chat provides it; elsewhere the
 * path shows its image inline.
 */
export interface PathHover {
  hover(path: string | null, anchor?: PreviewAnchor): void;
}

export const PathHoverContext = createContext<PathHover | null>(null);

export function usePathHover(): PathHover | null {
  return useContext(PathHoverContext);
}
