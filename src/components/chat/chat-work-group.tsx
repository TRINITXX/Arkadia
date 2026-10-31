import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ChatReadThumbs } from "@/components/chat/chat-read-thumbs";
import { ChatToolRow } from "@/components/chat/chat-tool-row";
import { readImagePath } from "@/lib/chat/chatImages";
import { workSummary, type ToolItem } from "@/lib/chat/chatGroups";
import { lastStep } from "@/lib/chat/chatSteps";

/**
 * A run of tool calls folded into one quiet line, its last call in words
 * after the counts once done: « 2 fichiers lus, 1 commande · lance pnpm
 * test ». While it runs, the counts alone: the live line above the input
 * is the one line that says Claude works.
 */
export function ChatWorkGroup({
  tools,
  cwd,
}: {
  tools: ToolItem[];
  cwd: string | null;
}) {
  const [open, setOpen] = useState(false);
  const failed = tools.filter((t) => t.result?.isError).length;
  // The last call an image read: its thumbnail stands for its path.
  const lastTool = tools[tools.length - 1];
  const step = lastStep(tools, cwd);
  const last = step && lastTool && readImagePath(lastTool) ? "lit" : step;
  return (
    <div className="chat-unit">
      <div className="chat-line" onClick={() => setOpen((o) => !o)}>
        <ChevronRight className={`chev${open ? " open" : ""}`} />
        <b>{workSummary(tools)}</b>
        {failed > 0 && <span>· {failed} en erreur</span>}
        {last && (
          <span className="chat-step" title={last}>
            · {last}
          </span>
        )}
        <ChatReadThumbs tools={tools} />
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
