import { Check, ShieldQuestion, X } from "lucide-react";
import { toolLabel, toolSummary } from "@/lib/chat/chatGroups";
import type { PermissionResult } from "@/lib/chat/chatProtocol";
import type { PendingRequest } from "@/lib/chat/chatState";

/** Any other tool Claude Code asks about: what it would do, allow or refuse. */
export function ChatPermissionPanel({
  request,
  onAnswer,
}: {
  request: PendingRequest;
  onAnswer: (result: PermissionResult) => void;
}) {
  const tool = {
    kind: "tool" as const,
    id: request.toolUseId,
    name: request.toolName,
    input: request.input,
  };
  const command =
    typeof request.input.command === "string" ? request.input.command : null;
  return (
    <div>
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
      <div className="chat-ask-actions">
        <button
          type="button"
          className="chat-btn primary"
          onClick={() =>
            onAnswer({ behavior: "allow", updatedInput: request.input })
          }
        >
          <Check /> Autoriser
        </button>
        <button
          type="button"
          className="chat-btn ghost"
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
