import { useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronRight,
  FilePen,
  FileText,
  Globe,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { ChatReadThumbs } from "@/components/chat/chat-read-thumbs";
import {
  activityCounts,
  activityTools,
  type ActivityKind,
  type FoldedUnit,
} from "@/lib/chat/chatGroups";
import { workTail } from "@/lib/chat/chatSteps";

const ICONS: Record<ActivityKind, LucideIcon> = {
  command: Terminal,
  read: FileText,
  search: Search,
  web: Globe,
  skill: Sparkles,
  tool: Wrench,
  edit: FilePen,
  agent: Bot,
};

/**
 * Claude's work between two messages on one quiet line: an icon and a
 * number per kind (commands, files read, files changed, subagents…), then
 * its last call in words once done (the user's pick B of 01/11/2026). While
 * it runs, the counts alone: the live line above the input says the step. A
 * click unfolds it as it was: tool lines, file cards, subagent rows.
 */
export function ChatActivityLine({
  units,
  cwd,
  render,
}: {
  units: FoldedUnit[];
  cwd: string | null;
  /** Draws a unit unfolded, as the column would. */
  render: (unit: FoldedUnit) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tools = useMemo(() => activityTools(units), [units]);
  const counts = useMemo(() => activityCounts(units), [units]);
  const { last, failed } = workTail(tools, cwd);
  return (
    <div className="chat-unit chat-activity">
      <div
        className="chat-line"
        title={counts.map((c) => c.label).join(", ")}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={`chev${open ? " open" : ""}`} />
        <span className="chat-counts">
          {counts.map(({ kind, n }) => {
            const Icon = ICONS[kind];
            return (
              <span key={kind} className="n">
                <Icon />
                {n}
              </span>
            );
          })}
        </span>
        {/* Grey as the rest of the line: an error Claude got past is no alarm
            (the user's ask of 01/11/2026). */}
        {failed > 0 && <span>· {failed} en erreur</span>}
        {last && (
          <span className="chat-step" title={last}>
            · {last}
          </span>
        )}
        <ChatReadThumbs tools={tools} />
      </div>
      {open && <div className="chat-activity-detail">{units.map(render)}</div>}
    </div>
  );
}
