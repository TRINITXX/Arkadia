import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Plug, Send, X } from "lucide-react";
import { openUrl } from "@/lib/bridge";
import {
  elicitContent,
  elicitFields,
  elicitUrl,
  initialValues,
  type ElicitValues,
} from "@/lib/chat/chatElicitation";
import { focusIsFree, focusOf } from "@/lib/chat/chatFocus";
import type { ElicitationAnswer } from "@/lib/chat/chatProtocol";
import { mcpName, type PendingElicitation } from "@/lib/chat/chatSdkSettings";
import { ChatElicitField } from "@/components/chat/chat-elicit-field";

/**
 * Keys this soon after the panel shows, or after a key it ignored, were typed
 * for something else (the input it replaced): they neither tick nor send.
 */
const KEY_GRACE_MS = 600;

/**
 * An MCP server asks the user something (`onElicitation`): a form built from
 * its schema, or a page to open (a sign-in). Accept or refuse; nothing is
 * preselected, the keyboard is taken only in the active pane when free, and
 * Enter in a field sends only past the grace (REVIEW.md « Panneaux de
 * demande du chat »). The server's words are untrusted: shown as text.
 */
export function ChatElicitationPanel({
  request,
  isActive,
  onAnswer,
}: {
  request: PendingElicitation;
  isActive: boolean;
  onAnswer: (result: ElicitationAnswer) => void;
}) {
  const url = request.mode === "url" ? elicitUrl(request.url) : null;
  const fields = useMemo(
    () => (request.mode === "url" ? [] : elicitFields(request.requestedSchema)),
    [request.mode, request.requestedSchema],
  );
  const [values, setValues] = useState<ElicitValues>(() =>
    initialValues(request.requestedSchema, fields),
  );
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const quietSince = useRef(0);

  useEffect(() => {
    quietSince.current = Date.now();
    // The panel itself, never a field of its own, and never from a field, the
    // search box or a menu (`focusIsFree`).
    if (isActive && focusIsFree(focusOf(rootRef.current)))
      rootRef.current?.focus();
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);

  const decline = () => onAnswer({ action: "decline" });
  const accept = () => {
    if (request.mode === "url") {
      if (url) void openUrl(url.href);
      onAnswer({ action: "accept" });
      return;
    }
    const answer = elicitContent(fields, values);
    if ("error" in answer) {
      setError(answer.error);
      return;
    }
    onAnswer({ action: "accept", content: answer.content });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (Date.now() - quietSince.current < KEY_GRACE_MS) {
      quietSince.current = Date.now();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Enter sends from a one-line field only: never on the panel itself.
    const target = e.target as HTMLElement;
    if (
      e.key === "Enter" &&
      target.tagName === "INPUT" &&
      (target as HTMLInputElement).type !== "checkbox"
    ) {
      e.preventDefault();
      accept();
    }
  };

  const set = (key: string, value: ElicitValues[string]) => {
    setError(null);
    setValues((v) => ({ ...v, [key]: value }));
  };

  const server = mcpName(request.displayName ?? request.serverName);
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDownCapture={onKey}
      style={{ outline: "none" }}
    >
      <div className="chat-ask-head">
        <Plug />
        <span>{request.title ?? `${server} demande`}</span>
        <small>serveur MCP</small>
      </div>
      {request.message && (
        <div className="chat-elicit-msg">{request.message}</div>
      )}
      {request.description && (
        <div className="chat-ask-sub">{request.description}</div>
      )}
      {request.mode === "url" ? (
        <div className="chat-elicit-url">
          {url ? (
            <>
              <b>{url.host}</b>
              <span title={url.href}>{url.href}</span>
            </>
          ) : (
            <span>Adresse refusée : {request.url ?? "aucune"}</span>
          )}
        </div>
      ) : (
        <div className="chat-elicit-form">
          {fields.map((f) => (
            <ChatElicitField
              key={f.key}
              field={f}
              value={values[f.key]}
              onChange={(v) => set(f.key, v)}
            />
          ))}
        </div>
      )}
      {error && <div className="chat-elicit-error">{error}</div>}
      <div className="chat-ask-actions">
        <button
          type="button"
          className="chat-btn primary"
          disabled={request.mode === "url" && !url}
          onClick={accept}
        >
          {request.mode === "url" ? (
            <>
              <ExternalLink /> Ouvrir la page
            </>
          ) : (
            <>
              <Send /> Envoyer
            </>
          )}
        </button>
        <button type="button" className="chat-btn ghost" onClick={decline}>
          <X /> Refuser
        </button>
      </div>
    </div>
  );
}
