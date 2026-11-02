import { useContext, useMemo } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import { ChatAttachments } from "@/components/chat/chat-attachments";
import { ChatPasteChip } from "@/components/chat/chat-paste-chip";
import { framePastes, pasteOfHref, withPasteTags } from "@/lib/chat/chatPastes";
import { LinkCardsContext, type LinkCards } from "@/lib/linkCards";
import type { AttachmentSource } from "@/components/chat/chat-attachment-card";
import { drawnImageKeys, userMessageView } from "@/lib/chat/chatImages";
import { imagePathKey, isVideoPath } from "@/lib/imagePaths";
import type { ChatItem } from "@/lib/chat/chatState";
import type { ImageRef } from "@/lib/imageGallery";

/**
 * What the user's frame holds: the text, then its pasted images and the
 * files it attaches as cards (`userMessageView`), never their paths as text.
 * The images its sentences name show as minis there (`MarkdownContent`).
 */
export function ChatUserBody({
  item,
  cwd,
  refs,
  onOpen,
  onToast,
}: {
  item: Extract<ChatItem, { kind: "user" }>;
  cwd: string | null;
  /** Its gallery strip (`chatGallery`): the pasted images, named for the
   *  lightbox's walk. */
  refs: ImageRef[];
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  const view = userMessageView(item, cwd);
  // The texts it sent from tags (`chatPastes`): tags again, their text on
  // hover (the user's pick 1 of 01/11/2026), as links the markdown draws
  // through the cards it already knows (`LinkCardsContext`). The iPhone's
  // frame follows the same rule (`framePastes`).
  const pasted = useMemo(
    () => framePastes(view.text, item.pastes),
    [view.text, item.pastes],
  );
  const shown = useMemo(
    () => withPasteTags(view.text, pasted),
    [pasted, view.text],
  );
  const drawn = useMemo(() => drawnImageKeys(shown, cwd), [shown, cwd]);
  const sources = useMemo<AttachmentSource[]>(
    () => [
      ...refs.flatMap((ref) =>
        ref.url
          ? [
              {
                kind: "pasted" as const,
                key: ref.path,
                url: ref.url,
                name: ref.path,
                inGallery: true,
              },
            ]
          : [],
      ),
      ...view.paths.map((path) => ({ kind: "path" as const, key: path, path })),
      // Named in a sentence: an image shows as a mini there; a video, or
      // an image its shown text doesn't draw (in a code, in a pasted
      // text's tag), gets its card once found, else nothing more.
      ...view.named
        .filter((path) => isVideoPath(path) || !drawn.has(imagePathKey(path)))
        .map((path) => ({
          kind: "path" as const,
          key: path,
          path,
          quiet: true,
        })),
    ],
    [refs, view.paths, view.named, drawn],
  );
  const outer = useContext(LinkCardsContext);
  const cards = useMemo<LinkCards | null>(() => {
    if (pasted.length === 0) return outer;
    function Card({ href, label }: { href: string; label: string }) {
      const paste = pasteOfHref(href, pasted);
      if (paste !== null) return <ChatPasteChip text={paste} label={label} />;
      return outer ? <outer.Card href={href} label={label} /> : null;
    }
    return {
      match: (href) =>
        pasteOfHref(href, pasted) !== null || !!outer?.match(href),
      Card,
    };
  }, [outer, pasted]);
  return (
    <>
      {view.text && (
        <div className="reading-md" data-chat-prose="">
          <LinkCardsContext.Provider value={cards}>
            <MarkdownContent
              text={shown}
              baseDir={cwd}
              onOpen={onOpen}
              onToast={onToast}
              inlineImages={false}
            />
          </LinkCardsContext.Provider>
        </div>
      )}
      <ChatAttachments
        sources={sources}
        dropped={item.images - (item.pasted?.length ?? 0)}
        onOpen={onOpen}
        onToast={onToast}
      />
    </>
  );
}
