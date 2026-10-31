import { useMemo } from "react";
import { CircleHelp } from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import { withoutQuestions } from "@/lib/chat/chatQuestionRound";

/**
 * Claude's reply in its frame. `bare`: the question sheet shows its
 * questions, so they leave the message while it does, Claude's other words
 * in place (`withoutQuestions`), and a line says where they went.
 */
export function ChatReplyText({
  text,
  bare,
  cwd,
  onOpen,
  onToast,
}: {
  text: string;
  bare: boolean;
  cwd: string | null;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  const shown = useMemo(
    () => (bare ? withoutQuestions(text) : text),
    [bare, text],
  );
  return (
    <>
      {(!bare || shown) && (
        <div className="reading-md" data-chat-prose="">
          <MarkdownContent
            text={shown || " "}
            baseDir={cwd}
            onOpen={onOpen}
            onToast={onToast}
            inlineImages={false}
          />
        </div>
      )}
      {bare && (
        <div className="chat-bare-note">
          <CircleHelp /> Ses questions sont dans la fiche, sous la conversation
        </div>
      )}
    </>
  );
}
