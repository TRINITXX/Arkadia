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

/** A plan Claude submitted, in the column: folded to its start, open on click. */
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
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-unit chat-card">
      <div className="head" onClick={() => setOpen((o) => !o)}>
        <ClipboardList />
        <span>Plan</span>
        <span style={{ color: "var(--chat-mute)" }}>
          · {planOutcome(tool, pending)}
        </span>
        <span className="tail">
          <ChevronRight
            size={15}
            style={{ transform: open ? "rotate(90deg)" : undefined }}
          />
        </span>
      </div>
      {/* While it waits, the input card shows it: not twice. */}
      {plan && !pending && (
        <div className={`body${open ? "" : " clamp"}`}>
          <div className="reading-md">
            <MarkdownContent
              text={plan}
              baseDir={cwd}
              onOpen={onOpen}
              onToast={onToast}
            />
          </div>
        </div>
      )}
    </div>
  );
}
