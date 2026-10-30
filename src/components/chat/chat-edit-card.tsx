import { useMemo, useState } from "react";
import { ChevronRight, FilePen, FilePlus2, CircleAlert } from "lucide-react";
import type { ToolItem } from "@/lib/chat/chatGroups";

/** Past this many lines a change opens folded. */
const OPEN_UNDER = 14;
const SHOWN_LINES = 400;

type DiffLine = { sign: "+" | "-"; text: string };

/** The lines a file change removes and adds, as its tool input states them. */
export function editDiff(tool: ToolItem): DiffLine[] {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  // A file's final newline ends its last line: it adds no line of its own.
  const lines = (text: string, sign: "+" | "-") =>
    text === ""
      ? []
      : text
          .replace(/\n$/, "")
          .split("\n")
          .map((t) => ({ sign, text: t }));
  const input = tool.input;
  if (tool.name === "Write") return lines(s(input.content), "+");
  if (tool.name === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.flatMap((e: Record<string, unknown>) => [
      ...lines(s(e.old_string), "-"),
      ...lines(s(e.new_string), "+"),
    ]);
  }
  if (tool.name === "NotebookEdit") return lines(s(input.new_source), "+");
  return [
    ...lines(s(input.old_string), "-"),
    ...lines(s(input.new_string), "+"),
  ];
}

/** A path as read from the session's folder. */
function shortPath(path: string, cwd: string | null): string {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const p = norm(path);
  const base = cwd ? norm(cwd).replace(/\/$/, "") + "/" : "";
  return base && p.toLowerCase().startsWith(base.toLowerCase())
    ? p.slice(base.length)
    : p;
}

/** A file change: its path and +/- counts, the diff open when it is short. */
export function ChatEditCard({
  tool,
  cwd,
}: {
  tool: ToolItem;
  cwd: string | null;
}) {
  const diff = useMemo(() => editDiff(tool), [tool]);
  const [open, setOpen] = useState(diff.length <= OPEN_UNDER);
  const added = diff.filter((l) => l.sign === "+").length;
  const removed = diff.length - added;
  const path = String(tool.input.file_path ?? tool.input.notebook_path ?? "");
  const Icon = tool.name === "Write" ? FilePlus2 : FilePen;
  return (
    <div className="chat-unit chat-card">
      <div className="head" onClick={() => setOpen((o) => !o)}>
        <Icon />
        <span className="path">{shortPath(path, cwd)}</span>
        {added > 0 && <span className="add">+{added}</span>}
        {removed > 0 && <span className="del">−{removed}</span>}
        {tool.result?.isError && <CircleAlert size={14} className="del" />}
        <span className="tail">
          <ChevronRight
            size={15}
            style={{ transform: open ? "rotate(90deg)" : undefined }}
          />
        </span>
      </div>
      {open && (
        <div className="chat-diff">
          {diff.slice(0, SHOWN_LINES).map((line, i) => (
            <div key={i} className={line.sign === "+" ? "p" : "m"}>
              {line.sign} {line.text}
            </div>
          ))}
          {diff.length > SHOWN_LINES && (
            <div className="more">
              … {diff.length - SHOWN_LINES} lignes de plus
            </div>
          )}
          {tool.result?.isError && <div className="m">{tool.result.text}</div>}
        </div>
      )}
    </div>
  );
}
