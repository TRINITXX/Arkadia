import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  MessagesSquare,
  Pencil,
  Sparkles,
  User,
} from "lucide-react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { messageTime, messageTimeFull } from "@/lib/messageTime";

const ROLES = {
  user: { label: "Toi", Icon: User },
  claude: { label: "Claude", Icon: Sparkles },
  peer: { label: "Message d'une autre session", Icon: MessagesSquare },
};

/** How long a copy button holds its ✓ (the code blocks' too). */
const COPIED_MS = 1200;

/**
 * A message in the terminal's frames (the display mod `outils-discrets`): the
 * user's in green, Claude's in violet, red-edged when the reply is an error,
 * another session's or a subagent's in blue (`label` names it). Its head says
 * who and when. « Copier le message » sits in the head on hover, and at the
 * foot of Claude's reply, always there but discreet.
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
  /** The head's words instead of the role's (a peer's « Message de … »). */
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
  const { Icon } = ROLES[role];
  const label = ownLabel ?? ROLES[role].label;
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
      <div className="chat-frame-head">
        <Icon />
        <b>{label}</b>
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
        {role !== "claude" && button}
      </div>
      {children}
      {role === "claude" && button && (
        <div className="chat-frame-foot">{button}</div>
      )}
    </div>
  );
}
