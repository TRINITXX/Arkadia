import { useMemo, useState } from "react";
import {
  ChevronRight,
  FilePen,
  FilePlus2,
  CircleAlert,
  SquareArrowOutUpRight,
} from "lucide-react";
import { openPath, type ToastFn } from "@/components/modern/MarkdownContent";
import { ChatDiffRows } from "@/components/chat/chat-diff-rows";
import { editDiff } from "@/lib/chat/chatDiff";
import type { ToolItem } from "@/lib/chat/chatGroups";

/** A path as read from the session's folder. */
function shortPath(path: string, cwd: string | null): string {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const p = norm(path);
  const base = cwd ? norm(cwd).replace(/\/$/, "") + "/" : "";
  return base && p.toLowerCase().startsWith(base.toLowerCase())
    ? p.slice(base.length)
    : p;
}

/** A file change: its path and +/- counts, folded until clicked (the user's pick of 01/11/2026). */
export function ChatEditCard({
  tool,
  cwd,
  onToast,
}: {
  tool: ToolItem;
  cwd: string | null;
  /** « Ouvrir le fichier » failing says so. */
  onToast?: ToastFn;
}) {
  // The real diff once the result is in (line numbers, context), else the input's.
  const patch = tool.result?.detail?.patch;
  const diff = useMemo(
    () => editDiff(tool.name, tool.input, patch),
    [tool.name, tool.input, patch],
  );
  const { added, removed } = diff;
  // A Write over an existing file is a change, not a new file.
  const created = tool.name === "Write" && patch?.write !== "update";
  // Never open by itself, short or not: a click opens it.
  const [open, setOpen] = useState(false);
  const path = String(tool.input.file_path ?? tool.input.notebook_path ?? "");
  const Icon = created ? FilePlus2 : FilePen;
  return (
    <div className="chat-unit chat-card">
      <div className="head" onClick={() => setOpen((o) => !o)}>
        <Icon />
        <span className="path">{shortPath(path, cwd)}</span>
        {added > 0 && <span className="add">+{added}</span>}
        {removed > 0 && <span className="del">−{removed}</span>}
        {tool.result?.isError && <CircleAlert size={14} className="del" />}
        {path && (
          // As a clickable path does: the file in its default app.
          <button
            type="button"
            className="chat-open-file"
            title={`Ouvrir ${path}`}
            aria-label="Ouvrir le fichier"
            onClick={(e) => {
              e.stopPropagation();
              openPath(path, onToast);
            }}
          >
            <SquareArrowOutUpRight />
          </button>
        )}
        <span className="tail">
          <ChevronRight
            size={15}
            style={{ transform: open ? "rotate(90deg)" : undefined }}
          />
        </span>
      </div>
      {open && (
        <ChatDiffRows diff={diff}>
          {tool.result?.isError && <div className="m">{tool.result.text}</div>}
        </ChatDiffRows>
      )}
    </div>
  );
}
