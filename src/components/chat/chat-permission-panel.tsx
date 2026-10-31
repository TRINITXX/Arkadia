import { useEffect, useRef } from "react";
import { Check, CheckCheck, ShieldQuestion, X } from "lucide-react";
import { toolLabel, toolSummary } from "@/lib/chat/chatGroups";
import {
  alwaysChoices,
  permissionAsker,
  suggestionDetail,
} from "@/lib/chat/chatPermissions";
import { focusIsFree, focusOf } from "@/lib/chat/chatFocus";
import { mcpName } from "@/lib/chat/chatSdkSettings";
import type { PermissionResult } from "@/lib/chat/chatProtocol";
import type { PendingRequest, Subagent } from "@/lib/chat/chatState";

/** Keys this soon after the panel shows were typed for something else. */
const KEY_GRACE_MS = 600;

/**
 * Any other tool Claude Code asks about: who asks (a subagent), what it would
 * do and on which path or MCP server, allow or refuse, or allow and stop
 * asking (one button per rule change it suggests, as the terminal's « Yes,
 * and don't ask again… »), unless Claude Code forbids it. Nothing is
 * preselected on Autoriser; a request Claude Code wants cautious
 * (`defaultToNo`) opens on Refuser, focused only in the active pane when no
 * field has the keyboard. Keys in the first `KEY_GRACE_MS` do nothing.
 */
export function ChatPermissionPanel({
  request,
  isActive = false,
  subagents = [],
  onAnswer,
}: {
  request: PendingRequest;
  /** Only the pane the user is in may take the keyboard. */
  isActive?: boolean;
  /** To name the subagent that asks. */
  subagents?: Subagent[];
  onAnswer: (result: PermissionResult) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const refuseRef = useRef<HTMLButtonElement>(null);
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
    if (!request.defaultToNo || !isActive) return;
    // Never from the terminal, a field, the search box or a menu (`focusIsFree`).
    if (focusIsFree(focusOf(rootRef.current))) refuseRef.current?.focus();
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);
  const asker = permissionAsker(request.agentId, subagents);
  const tool = {
    kind: "tool" as const,
    id: request.toolUseId,
    name: request.toolName,
    input: request.input,
  };
  const command =
    typeof request.input.command === "string" ? request.input.command : null;
  const always = alwaysChoices(request);
  const cautious = request.defaultToNo === true;
  return (
    <div
      ref={rootRef}
      onKeyDownCapture={(e) => {
        if (Date.now() - shownAt.current >= KEY_GRACE_MS) return;
        shownAt.current = Date.now();
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {asker && <div className="chat-perm-asker">{asker}</div>}
      <div className="chat-ask-head">
        <ShieldQuestion />
        <span>
          {request.title ?? `Autoriser ${toolLabel(request.toolName)} ?`}
        </span>
      </div>
      {request.description && (
        <div className="chat-ask-sub">{request.description}</div>
      )}
      <div className="chat-perm-input">
        {command ??
          (toolSummary(tool) || JSON.stringify(request.input, null, 2))}
      </div>
      {(request.blockedPath || request.mcpServer) && (
        <div className="chat-perm-facts">
          {request.blockedPath && (
            <div>
              Chemin concerné : <code>{request.blockedPath}</code>
            </div>
          )}
          {request.mcpServer && (
            <div>
              Serveur MCP : <b>{mcpName(request.mcpServer.name)}</b>
              {request.mcpServer.source !== "sdk" &&
                ` (configuré : ${request.mcpServer.source})`}
            </div>
          )}
        </div>
      )}
      <div className="chat-ask-actions">
        <button
          type="button"
          className={cautious ? "chat-btn" : "chat-btn primary"}
          onClick={() =>
            onAnswer({ behavior: "allow", updatedInput: request.input })
          }
        >
          <Check /> Autoriser
        </button>
        {always.map(({ suggestion, label }) => (
          <button
            key={label}
            type="button"
            className="chat-btn chat-perm-always"
            title={suggestionDetail(suggestion)}
            onClick={() =>
              onAnswer({
                behavior: "allow",
                updatedInput: request.input,
                updatedPermissions: [suggestion],
              })
            }
          >
            <CheckCheck /> <span>{label}</span>
          </button>
        ))}
        <button
          ref={refuseRef}
          type="button"
          className={cautious ? "chat-btn chat-perm-no" : "chat-btn ghost"}
          title={
            cautious
              ? "Claude Code conseille de refuser par défaut cette action"
              : undefined
          }
          onClick={() =>
            onAnswer({
              behavior: "deny",
              message: "The user refused this action.",
            })
          }
        >
          <X /> Refuser
        </button>
      </div>
    </div>
  );
}
