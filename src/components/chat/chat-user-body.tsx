import { useMemo } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import { ChatAttachments } from "@/components/chat/chat-attachments";
import type { AttachmentSource } from "@/components/chat/chat-attachment-card";
import { userMessageView } from "@/lib/chat/chatImages";
import type { ChatItem } from "@/lib/chat/chatState";
import type { ImageRef } from "@/lib/imageGallery";

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
  return (
    <>
      {view.text && (
        <div className="reading-md" data-chat-prose="">
          <MarkdownContent
            text={view.text}
            baseDir={cwd}
            onOpen={onOpen}
            onToast={onToast}
            inlineImages={false}
          />
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
