import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ChatToolRow } from "@/components/chat/chat-tool-row";
import { workSummary, type ToolItem } from "@/lib/chat/chatGroups";
import { lastStep } from "@/lib/chat/chatSteps";

/**
 * A run of tool calls folded into one quiet line, its last call in words
 * after the counts: « 2 fichiers lus, 1 commande · lance pnpm test ».
 */
export function ChatWorkGroup({
  tools,
  cwd,
}: {
  tools: ToolItem[];
  cwd: string | null;
}) {
  const [open, setOpen] = useState(false);
  const running = tools.some((t) => !t.result);
  const failed = tools.filter((t) => t.result?.isError).length;
  const last = lastStep(tools, cwd);
  return (
    <div className="chat-unit">
      <div className="chat-line" onClick={() => setOpen((o) => !o)}>
        {running ? (
          <span className="spin" />
        ) : (
          <ChevronRight className={`chev${open ? " open" : ""}`} />
        )}
        <b>{workSummary(tools)}</b>
        {failed > 0 && <span>· {failed} en erreur</span>}
        {last && (
          <span className="chat-step" title={last}>
            · {last}
          </span>
        )}
      </div>
      {open && (
        <div className="chat-tools">
          {tools.map((tool) => (
            <ChatToolRow key={tool.id} tool={tool} cwd={cwd} />
          ))}
        </div>
      )}
    </div>
  );
}
