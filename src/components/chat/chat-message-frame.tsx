import { useEffect, useRef, useState } from "react";
import { Check, Copy, MessagesSquare, Pencil } from "lucide-react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { messageTime, messageTimeFull } from "@/lib/messageTime";

/** Another session's frame names its sender; the user's and Claude's need no name. */
const PEER_LABEL = "Message d'une autre session";

/** How long a copy button holds its ✓ (the code blocks' too). */
const COPIED_MS = 1200;

/**
 * A message in the terminal's frames (the display mod `outils-discrets`): the
 * user's in green, Claude's in violet, red-edged when the reply is an error,
 * another session's in blue, under a head naming it (`label`). Its foot has
 * the time at the left, « Modifier » and « Copier le message » at the right,
 * discreet (the user's pick of 01/11/2026: no « Toi » nor « Claude »).
 */
export function ChatMessageFrame({
  role,
  label: ownLabel,
  at,
  text,
  error = false,
  cut = false,
  className,
  onToast,
  onEdit,
  editBlocked = null,
  children,
}: {
  role: "user" | "claude" | "peer";
  /** A peer's head (« Message de … »); the other roles have none. */
  label?: string;
  /** When it was said (ms); no time shown when unknown. */
  at?: number;
  /** What « Copier le message » copies: the markdown as written. */
  text: string;
  error?: boolean;
  /** Claude's reply cut by Esc before its end: marked « coupé ». */
  cut?: boolean;
  /** Extra classes: `chat-user` (with `queued`), `chat-text` (`streaming`). */
  className?: string;
  onToast?: ToastFn;
  /** The user's message brought back to the input (`useMessageEdit`). */
  onEdit?: () => void;
  /** Why the pencil can't act now: it stays, dim, saying so on hover. */
  editBlocked?: string | null;
  children: React.ReactNode;
}) {
  const label = ownLabel ?? PEER_LABEL;
  const iso = at === undefined ? null : new Date(at).toISOString();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const copy = () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        onToast?.("info", "Message copié");
        setCopied(true);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch((e: unknown) =>
        onToast?.("error", `Copie impossible : ${String(e)}`),
      );
  };
  const button = text ? (
    <button
      type="button"
      className={`copy${copied ? " copied" : ""}`}
      title="Copier le message"
      aria-label="Copier le message"
      onClick={(e) => {
        e.stopPropagation();
        copy();
      }}
    >
      {copied ? <Check /> : <Copy />}
    </button>
  ) : null;
  return (
    <div
      className={`chat-unit chat-frame ${role}${error ? " error" : ""}${className ? ` ${className}` : ""}`}
    >
      {role === "peer" && (
        <div className="chat-frame-head">
          <MessagesSquare />
          <b>{label}</b>
        </div>
      )}
      {children}
      <div className="chat-frame-foot">
        {iso && (
          <time dateTime={iso} title={messageTimeFull(iso) ?? undefined}>
            {messageTime(iso)}
          </time>
        )}
        {cut && (
          <span className="chat-cut" title="Réponse coupée par Échap">
            coupé
          </span>
        )}
        <span className="tools">
          {role === "user" && onEdit && (
            <button
              type="button"
              className={`copy edit${editBlocked ? " blocked" : ""}`}
              title={
                editBlocked ??
                "Modifier ce message (la conversation revient juste avant)"
              }
              aria-label="Modifier ce message"
              aria-disabled={editBlocked ? true : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (!editBlocked) onEdit();
              }}
            >
              <Pencil />
            </button>
          )}
          {button}
        </span>
      </div>
    </div>
  );
}
