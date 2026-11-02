import { useEffect } from "react";
import {
  CodeCopyContext,
  type CodeCopyListener,
} from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import {
  ImageHoverPreview,
  useImageHoverPreview,
} from "@/components/ImageHoverPreview";
import { ChatArtifactCard } from "@/components/chat/chat-artifact-card";
import { ChatLightboxContext } from "@/lib/chat/chatLightbox";
import { LinkCardsContext, type LinkCards } from "@/lib/linkCards";
import { isArtifactUrl } from "@/lib/artifactUrl";
import { PathHoverContext } from "@/lib/pathHover";

/** Artifact links in the chat's prose: cards (the reading view keeps links). */
const LINK_CARDS: LinkCards = { match: isArtifactUrl, Card: ChatArtifactCard };

/**
 * What the chat's markdown reads from above: where a code block's copy
 * reports, which links it draws as cards, the lightbox (`onOpen`), and the
 * card an image path shows while hovered, as in the terminal (look-only: a
 * click on the path opens the lightbox).
 */
export function ChatProseContexts({
  codeCopy,
  onOpen = null,
  children,
}: {
  codeCopy: CodeCopyListener;
  onOpen?: ((content: LightboxContent) => void) | null;
  children: React.ReactNode;
}) {
  const { preview, api, elRef } = useImageHoverPreview();
  // The wheel moves the path from under the card, a key or a press means the
  // user is on to something else: it goes, as in the terminal.
  useEffect(() => {
    const kinds = ["wheel", "keydown", "pointerdown"] as const;
    for (const kind of kinds)
      window.addEventListener(kind, api.hide, { passive: true, capture: true });
    return () => {
      for (const kind of kinds)
        window.removeEventListener(kind, api.hide, { capture: true });
    };
  }, [api]);
  return (
    <CodeCopyContext.Provider value={codeCopy}>
      <LinkCardsContext.Provider value={LINK_CARDS}>
        <ChatLightboxContext.Provider value={onOpen}>
          <PathHoverContext.Provider value={api}>
            {children}
          </PathHoverContext.Provider>
        </ChatLightboxContext.Provider>
      </LinkCardsContext.Provider>
      {preview && <ImageHoverPreview preview={preview} elRef={elRef} />}
    </CodeCopyContext.Provider>
  );
}
