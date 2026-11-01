import { useContext, useMemo } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import { ChatAttachments } from "@/components/chat/chat-attachments";
import { ChatPasteChip } from "@/components/chat/chat-paste-chip";
import { pastesIn, wordCount } from "@/lib/chat/chatPastes";
import { LinkCardsContext, type LinkCards } from "@/lib/linkCards";
import type { AttachmentSource } from "@/components/chat/chat-attachment-card";
import { userMessageView } from "@/lib/chat/chatImages";
import type { ChatItem } from "@/lib/chat/chatState";
import type { ImageRef } from "@/lib/imageGallery";

/** « 12 mots », « 1 mot ». */
const wordsLabel = (text: string) => {
  const n = wordCount(text);
  return `${n} mot${n > 1 ? "s" : ""}`;
};

/** A sent paste's tag, as a link the frame's markdown draws as a chip. */
const PASTE_HREF = "#arkadia-paste-";

/**
 * What the user's frame holds: the text, then its pasted images and the
 * files it attaches as cards (`userMessageView`), never their paths as text.
 * The images its sentences name get a thumbnail once found, nothing else.
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
      // Named in a sentence: a thumbnail once found, else nothing more.
      ...view.named.map((path) => ({
        kind: "path" as const,
        key: path,
        path,
        quiet: true,
      })),
    ],
    [refs, view.paths, view.named],
  );
  // The texts it sent from tags (`chatPastes`): tags again, their text on
  // hover (the user's pick 1 of 01/11/2026), as links the markdown draws
  // through the cards it already knows (`LinkCardsContext`).
  const pasted = useMemo(() => pastesIn(view.text), [view.text]);
  const shown = useMemo(
    () =>
      pasted.reduce(
        (t, paste, i) =>
          t
            .split(paste)
            .join(`[Texte collé · ${wordsLabel(paste)}](${PASTE_HREF}${i})`),
        view.text,
      ),
    [pasted, view.text],
  );
  const outer = useContext(LinkCardsContext);
  const cards = useMemo<LinkCards | null>(() => {
    if (pasted.length === 0) return outer;
    const ours = (href: string) => href.startsWith(PASTE_HREF);
    function Card({ href, label }: { href: string; label: string }) {
      if (ours(href))
        return (
          <ChatPasteChip
            text={pasted[Number(href.slice(PASTE_HREF.length))] ?? ""}
            label={label}
          />
        );
      return outer ? <outer.Card href={href} label={label} /> : null;
    }
    return { match: (href) => ours(href) || !!outer?.match(href), Card };
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
