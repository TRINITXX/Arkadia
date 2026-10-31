import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { toolIcon } from "@/components/modern/toolIcons";
import { toolLabel, type ToolItem } from "@/lib/chat/chatGroups";
import { toolStep } from "@/lib/chat/chatSteps";

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
  const step = toolStep(tool.name, tool.input, cwd);
  const command =
    tool.name === "Bash" || tool.name === "PowerShell"
      ? String(tool.input.command ?? "")
      : "";
  const output = tool.result?.text ?? "";
  return (
    <div className="chat-tool">
      <div className="row" onClick={() => setOpen((o) => !o)}>
        <Icon size={13} />
        <span className="name">{toolLabel(tool.name)}</span>
        <span className="step" title={step}>
          {step}
        </span>
        {tool.result?.isError && <CircleAlert size={13} className="err" />}
      </div>
      {open && (
        <div className="out">
          {command && `$ ${command}\n\n`}
          {output
            ? output.length > OUTPUT_CAP
              ? `${output.slice(0, OUTPUT_CAP)}\n…`
              : output
            : tool.result
              ? "(rien)"
              : "En cours…"}
        </div>
      )}
    </div>
  );
}
