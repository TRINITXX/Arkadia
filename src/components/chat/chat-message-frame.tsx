import { useEffect, useRef, useState } from "react";
import { Check, Copy, Sparkles, User } from "lucide-react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { messageTime, messageTimeFull } from "@/lib/messageTime";

const ROLES = {
  user: { label: "Toi", Icon: User },
  claude: { label: "Claude", Icon: Sparkles },
};

/** How long a copy button holds its ✓ (the code blocks' too). */
const COPIED_MS = 1200;

/**
 * A message in the terminal's frames (the display mod `outils-discrets`): the
 * user's in green, Claude's in violet, red-edged when the reply is an error.
 * Its head says who and when. « Copier le message » sits in the user's head
 * on hover, and at the foot of Claude's reply, always there but discreet.
 */
export function ChatMessageFrame({
  role,
  at,
  text,
  error = false,
  className,
  onToast,
  children,
}: {
  role: "user" | "claude";
  /** When it was said (ms); no time shown when unknown. */
  at?: number;
  /** What « Copier le message » copies: the markdown as written. */
  text: string;
  error?: boolean;
  /** Extra classes: `chat-user` (with `queued`), `chat-text` (`streaming`). */
  className?: string;
  onToast?: ToastFn;
  children: React.ReactNode;
}) {
  const { label, Icon } = ROLES[role];
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
        {role === "user" && button}
      </div>
      {children}
      {role === "claude" && button && (
        <div className="chat-frame-foot">{button}</div>
      )}
    </div>
  );
}
