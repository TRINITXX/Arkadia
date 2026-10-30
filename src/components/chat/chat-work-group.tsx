import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ChatToolRow } from "@/components/chat/chat-tool-row";
import { workSummary, type ToolItem } from "@/lib/chat/chatGroups";

/** A run of tool calls folded into one quiet line ("4 commandes, 3 fichiers lus"). */
export function ChatWorkGroup({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((t) => !t.result);
  const failed = tools.filter((t) => t.result?.isError).length;
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
      </div>
      {open && (
        <div className="chat-tools">
          {tools.map((tool) => (
            <ChatToolRow key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
