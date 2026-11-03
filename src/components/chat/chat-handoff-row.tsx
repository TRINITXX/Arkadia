import { useLayoutEffect, useRef, useState } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import type { ChatItem } from "@/lib/chat/chatState";

type NoticeItem = Extract<ChatItem, { kind: "notice" }>;

/** A row of the old session, above a handoff's separator (`chat-css`). */
const PAST = "chat-past-row";
/** The conversation's rows: the chat's title and line above them stay as they are. */
const ROWS = ".chat-unit, .chat-day";

/**
 * Greys the column's rows above the separator `row`, those loaded later
 * (older pages) too, until it goes. A class on each row, no wrapper: the
 * rows keep their place (no remount, the column's scroll memory counts
 * them one by one). A separator further down keeps its own rows greyed.
 */
function useGreyAbove(row: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const self = row.current;
    const column = self?.parentElement;
    if (!self || !column) return;
    const mark = () => {
      for (
        let el = self.previousElementSibling;
        el;
        el = el.previousElementSibling
      )
        if (el.matches(ROWS)) el.classList.add(PAST);
    };
    mark();
    const watch = new MutationObserver(mark);
    watch.observe(column, { childList: true });
    return () => {
      watch.disconnect();
      for (
        let el = self.previousElementSibling;
        el;
        el = el.previousElementSibling
      )
        el.classList.remove(PAST);
    };
  }, [row]);
}

/**
 * The separator of a handoff (`chatHandoff`): the old session above it,
 * greyed (`useGreyAbove`), the new one below. Once written, « Voir la
 * passation » unfolds what Claude got, and « Reprendre l'ancienne en
 * entier » resumes the old session as it was (its whole context read again).
 */
export function ChatHandoffRow({
  item,
  cwd,
  onOpen,
  onToast,
  onResumeOld,
}: {
  item: NoticeItem;
  cwd: string | null;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
  onResumeOld?: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useGreyAbove(ref);
  const handoff = item.handoff;
  if (!handoff) return null;
  const done = handoff.phase === "done" ? handoff : null;
  return (
    <div ref={ref} className="chat-unit chat-handoff">
      <div className="chat-handoff-rule" role="separator">
        {!done && <span className="spin" aria-hidden />}
        <span>{item.text}</span>
      </div>
      {done && (
        <div className="chat-handoff-links">
          <button type="button" onClick={() => setOpen((o) => !o)}>
            {open ? "Masquer la passation" : "Voir la passation"}
          </button>
          {onResumeOld && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                title="Relit toute l'ancienne conversation : son cache a expiré"
                onClick={() => onResumeOld(done.from)}
              >
                {"Reprendre l'ancienne en entier"}
              </button>
            </>
          )}
        </div>
      )}
      {done && open && (
        <div className="chat-handoff-text reading-md" data-chat-prose="">
          <MarkdownContent
            text={done.summary || " "}
            baseDir={cwd}
            onOpen={onOpen}
            onToast={onToast}
            inlineImages={false}
          />
        </div>
      )}
    </div>
  );
}
