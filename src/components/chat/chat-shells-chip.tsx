import { useEffect, useRef, useState } from "react";
import { SquareTerminal } from "lucide-react";
import { elapsedLabel } from "@/lib/chat/chatLabels";
import { useChatLayer } from "@/lib/chat/useChatLayers";
import { useChatShown } from "@/lib/chat/useChatShown";
import { outputTail, type BackgroundShell } from "@/lib/chat/chatTasks";
import type { ShellOutput } from "@/lib/chat/useShellOutputs";

/** While the list is open, each shell's output is asked again this often. */
const OUTPUT_POLL_MS = 1_000;

/**
 * The background commands, a cyan « N shells » chip under the input (the
 * user's pick of 30/10/2026). A click lists them: command, running time and
 * the last lines they wrote, read again every second while open. No stop
 * button: Claude stops its own commands.
 */
export function ChatShellsChip({
  shells,
  commands,
  outputs,
  now,
  onOutput,
}: {
  /** Running in the background (`runningShells`). */
  shells: BackgroundShell[];
  /** Each shell's command line, by task id, when its Bash call is known. */
  commands: Record<string, string>;
  outputs: Record<string, ShellOutput>;
  now: number;
  onOutput?: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const ids = shells.map((s) => s.taskId).join(" ");

  // Asked at once, then every second, while the list shows (its tab too).
  const shown = useChatShown();
  useEffect(() => {
    if (!open || !shown || !onOutput || !ids) return;
    const ask = () => ids.split(" ").forEach((id) => onOutput(id));
    ask();
    const timer = window.setInterval(ask, OUTPUT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, shown, onOutput, ids]);

  // Esc closes it through the pane (never Claude's turn), a click elsewhere too.
  useChatLayer(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [open]);

  useEffect(() => {
    if (shells.length === 0) setOpen(false);
  }, [shells.length]);

  if (shells.length === 0) return null;
  const n = shells.length;
  return (
    <span className="chat-anchor chat-shells" ref={rootRef}>
      <span
        className="chat-chip shells"
        onClick={() => setOpen((o) => !o)}
        title="Commandes en arrière-plan"
      >
        <SquareTerminal /> {n} shell{n > 1 ? "s" : ""}
      </span>
      {open && (
        <div className="chat-shells-list">
          {shells.map((s) => {
            const out = outputs[s.taskId];
            const tail = out ? outputTail(out.output) : "";
            return (
              <div key={s.taskId} className="shell">
                <div className="head">
                  <span
                    className="cmd"
                    title={commands[s.taskId] ?? s.description}
                  >
                    {commands[s.taskId] ?? s.description}
                  </span>
                  <span className="dur">{elapsedLabel(now - s.startedAt)}</span>
                </div>
                {commands[s.taskId] && s.description && (
                  <div className="what">{s.description}</div>
                )}
                <pre className={`out${tail ? "" : " empty"}`}>
                  {out?.error
                    ? "Sortie illisible"
                    : !out
                      ? "Lecture de la sortie…"
                      : tail || "Rien d'écrit pour l'instant"}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}
