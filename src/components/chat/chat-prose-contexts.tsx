import {
  CodeCopyContext,
  type CodeCopyListener,
} from "@/components/modern/MarkdownContent";
import { ChatArtifactCard } from "@/components/chat/chat-artifact-card";
import { LinkCardsContext, type LinkCards } from "@/lib/linkCards";
import { isArtifactUrl } from "@/lib/openLink";

/** Artifact links in the chat's prose: cards (the reading view keeps links). */
const LINK_CARDS: LinkCards = { match: isArtifactUrl, Card: ChatArtifactCard };

/**
 * What the chat's markdown reads from above: where a code block's copy
 * reports, and which links it draws as cards.
 */
export function ChatProseContexts({
  codeCopy,
  children,
}: {
  codeCopy: CodeCopyListener;
  children: React.ReactNode;
}) {
  return (
    <CodeCopyContext.Provider value={codeCopy}>
      <LinkCardsContext.Provider value={LINK_CARDS}>
        {children}
      </LinkCardsContext.Provider>
    </CodeCopyContext.Provider>
  );
}
