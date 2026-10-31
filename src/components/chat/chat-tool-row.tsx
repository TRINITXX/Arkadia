import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { toolIcon } from "@/components/modern/toolIcons";
import { toolLabel, type ToolItem } from "@/lib/chat/chatGroups";
import { toolStep } from "@/lib/chat/chatSteps";
import { shellMarks } from "@/lib/chat/chatToolResult";
import { ChatShellOutput } from "@/components/chat/chat-shell-output";
import { ChatReadThumbs } from "@/components/chat/chat-read-thumbs";
import { readImagePath } from "@/lib/chat/chatImages";

/** A tool's output is shown up to this, its tail cut. */
const OUTPUT_CAP = 6000;

/** One tool call of a folded run: its name and what it does in words, its
 *  output on click. */
export function ChatToolRow({
  tool,
  cwd,
}: {
  tool: ToolItem;
  cwd: string | null;
}) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(tool.name);
  // An image read: its thumbnail stands for its path (`ChatReadThumbs`).
  const step = readImagePath(tool)
    ? "lit"
    : toolStep(tool.name, tool.input, cwd);
  const command =
    tool.name === "Bash" || tool.name === "PowerShell"
      ? String(tool.input.command ?? "")
      : "";
  const output = tool.result?.text ?? "";
  // A command's output and errors apart, and how it ended (`toolDetail`).
  const shell = tool.result?.detail?.shell;
  const streams =
    shell && (shell.stdout !== undefined || shell.stderr !== undefined);
  return (
    <div className="chat-tool">
      <div className="row" onClick={() => setOpen((o) => !o)}>
        <Icon size={13} />
        <span className="name">{toolLabel(tool.name)}</span>
        <span className="step" title={step}>
          {step}
        </span>
        {shell &&
          shellMarks(shell).map((mark) => (
            <span key={mark} className="chat-mark">
              {mark}
            </span>
          ))}
        <ChatReadThumbs tools={[tool]} />
        {tool.result?.isError && <CircleAlert size={13} className="err" />}
      </div>
      {open && shell && streams && (
        <ChatShellOutput command={command} shell={shell} text={output} />
      )}
      {open && !streams && (
        <div className="out">
          {command && `$ ${command}\n\n`}
          {output
            ? output.length > OUTPUT_CAP
              ? `${output.slice(0, OUTPUT_CAP)}\n…`
              : output
            : tool.result
              ? "(rien)"
              : tool.stale
                ? "(sans résultat)"
                : "En cours…"}
        </div>
      )}
    </div>
  );
}
