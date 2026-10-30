import { useState } from "react";
import { Check, ClipboardList, Pencil, Zap } from "lucide-react";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { PermissionMode, PermissionResult } from "@/lib/chat/chatProtocol";
import type { PendingRequest } from "@/lib/chat/chatState";

/**
 * ExitPlanMode, inside the input card: the plan, then the terminal's choices
 * (go on in auto mode, approve each edit, or keep planning with a remark).
 */
export function ChatPlanApproval({
  request,
  plan,
  cwd,
  onAnswer,
  onMode,
  onOpen,
  onToast,
}: {
  request: PendingRequest;
  plan: string | null;
  cwd: string | null;
  onAnswer: (result: PermissionResult) => void;
  onMode: (mode: PermissionMode) => void;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  const [remark, setRemark] = useState("");
  const approve = (mode?: PermissionMode) => {
    onAnswer({ behavior: "allow", updatedInput: request.input });
    // Approving leaves plan mode for the default one: switch after.
    if (mode) onMode(mode);
  };
  return (
    <div>
      <div className="chat-ask-head">
        <ClipboardList />
        <span>Claude propose ce plan</span>
      </div>
      {plan ? (
        <div className="chat-plan">
          <div className="reading-md">
            <MarkdownContent
              text={plan}
              baseDir={cwd}
              onOpen={onOpen}
              onToast={onToast}
            />
          </div>
        </div>
      ) : (
        <div className="chat-ask-sub">
          Plan introuvable : regarde au-dessus dans la conversation.
        </div>
      )}
      <input
        className="chat-ask-other"
        placeholder="Une remarque pour continuer le plan…"
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && remark.trim()) {
            e.preventDefault();
            onAnswer({ behavior: "deny", message: remark.trim() });
          }
        }}
      />
      <div className="chat-ask-actions">
        <button
          type="button"
          className="chat-btn primary"
          onClick={() => approve("auto")}
        >
          <Zap /> Oui, en mode auto
        </button>
        <button
          type="button"
          className="chat-btn"
          onClick={() => approve("acceptEdits")}
        >
          <Check /> Oui, modifs acceptées
        </button>
        <button type="button" className="chat-btn" onClick={() => approve()}>
          <Check /> Oui, je valide chaque modif
        </button>
        <button
          type="button"
          className="chat-btn ghost"
          onClick={() =>
            onAnswer({
              behavior: "deny",
              message: remark.trim() || "The user wants to keep planning.",
            })
          }
        >
          <Pencil /> Non, continue le plan
        </button>
      </div>
    </div>
  );
}
