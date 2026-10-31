import { useState } from "react";
import { ClipboardList, ChevronRight } from "lucide-react";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import type { ToolItem } from "@/lib/chat/chatGroups";

/** How a plan's approval ended, from ExitPlanMode's result. */
function planOutcome(tool: ToolItem, pending: boolean): string {
  if (pending) return "en attente de ta réponse";
  if (!tool.result) return "";
  return tool.result.isError ||
    /reject|denied|refus|keep planning/i.test(tool.result.text)
    ? "refusé"
    : "approuvé";
}

/**
 * A plan Claude submitted, in the column. Waiting for the user, it shows in
 * full (the panel below holds only the choices) and stays open once decided;
 * a plan met later in the history shows folded to its start, open on click.
 */
export function ChatPlanCard({
  tool,
  plan,
  pending,
  cwd,
  onOpen,
  onToast,
}: {
  tool: ToolItem;
  plan: string | null;
  pending: boolean;
  cwd: string | null;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  const [open, setOpen] = useState(pending);
  // A live card mounts as Claude writes the call, before its request: it
  // opens once the request comes and stays open after the answer.
  const [seenPending, setSeenPending] = useState(pending);
  if (pending && !seenPending) {
    setSeenPending(true);
    setOpen(true);
  }
  const full = open || pending;
  return (
    <div
      className={`chat-unit chat-card chat-plan-card${pending ? " pending" : ""}`}
    >
      <div className="head" onClick={() => setOpen((o) => !o)}>
        <ClipboardList />
        <span>Plan</span>
        <span style={{ color: "var(--chat-mute)" }}>
          · {planOutcome(tool, pending)}
        </span>
        <span className="tail">
          <ChevronRight
            size={15}
            style={{ transform: full ? "rotate(90deg)" : undefined }}
          />
        </span>
      </div>
      {plan && (
        <div className={`body${full ? "" : " clamp"}`}>
          <div className="reading-md">
            <MarkdownContent
              text={plan}
              baseDir={cwd}
              onOpen={onOpen}
              onToast={onToast}
              inlineImages={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}
