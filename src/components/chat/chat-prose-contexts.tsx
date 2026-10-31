import {
  CodeCopyContext,
  type CodeCopyListener,
} from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { ChatArtifactCard } from "@/components/chat/chat-artifact-card";
import { ChatLightboxContext } from "@/lib/chat/chatLightbox";
import { LinkCardsContext, type LinkCards } from "@/lib/linkCards";
import { isArtifactUrl } from "@/lib/openLink";

/** Artifact links in the chat's prose: cards (the reading view keeps links). */
const LINK_CARDS: LinkCards = { match: isArtifactUrl, Card: ChatArtifactCard };

/**
 * What the chat's markdown reads from above: where a code block's copy
 * reports, which links it draws as cards, and the lightbox (`onOpen`).
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
  return (
    <CodeCopyContext.Provider value={codeCopy}>
      <LinkCardsContext.Provider value={LINK_CARDS}>
        <ChatLightboxContext.Provider value={onOpen}>
          {children}
        </ChatLightboxContext.Provider>
      </LinkCardsContext.Provider>
    </CodeCopyContext.Provider>
  );
}
