import { useMemo } from "react";
import { CircleHelp } from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import { ChatGallery } from "@/components/chat/chat-gallery";
import { drawnImageKeys, stripRefs } from "@/lib/chat/chatImages";
import { endsWithHourglass } from "@/lib/chat/chatHourglass";
import { withoutQuestions } from "@/lib/chat/chatQuestionRound";
import { splitTechDetail } from "@/lib/chat/chatTechDetail";
import type { ImageRef } from "@/lib/imageGallery";

/**
 * Claude's reply in its frame. `bare`: the question sheet shows its
 * questions, so they leave the message while it does, Claude's other words
 * in place (`withoutQuestions`), and a line says where they went. Under
 * it, the strip of the images its words name but don't show as minis (in
 * a code block, in the sheet's questions) and of its videos.
 */
export function ChatReplyText({
  text,
  bare,
  cwd,
  refs,
  onOpen,
  onToast,
}: {
  text: string;
  bare: boolean;
  cwd: string | null;
  /** Its images (`chatGallery`), for the strip. */
  refs: ImageRef[];
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  const shown = useMemo(
    () => (bare ? withoutQuestions(text) : text),
    [bare, text],
  );
  const strip = useMemo(
    () => stripRefs(refs, drawnImageKeys(shown, cwd)),
    [refs, shown, cwd],
  );
  // « Détail technique » after the last rule: greyed, apart (03/11/2026).
  const parts = useMemo(() => splitTechDetail(shown), [shown]);
  return (
    <>
      {(!bare || shown) && (
        <div
          className="reading-md"
          data-chat-prose=""
          data-hourglass={endsWithHourglass(shown) ? "" : undefined}
        >
          <MarkdownContent
            text={(parts ? parts.main : shown) || " "}
            baseDir={cwd}
            onOpen={onOpen}
            onToast={onToast}
            inlineImages={false}
          />
          {parts && (
            <div className="chat-tech">
              <MarkdownContent
                text={parts.tech}
                baseDir={cwd}
                onOpen={onOpen}
                onToast={onToast}
                inlineImages={false}
              />
            </div>
          )}
        </div>
      )}
      {bare && (
        <div className="chat-bare-note">
          <CircleHelp /> Ses questions sont dans la fiche, sous la conversation
        </div>
      )}
      <ChatGallery refs={strip} onOpen={onOpen} />
    </>
  );
}
