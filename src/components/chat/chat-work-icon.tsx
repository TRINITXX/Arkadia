import { Wrench } from "lucide-react";
import { ChatHoverCard } from "@/components/chat/chat-hover-card";
import type { FoldedUnit } from "@/lib/chat/chatGroups";

/** Claude's tools behind a wrench once their exchange is past, drawn as an
 *  activity line unfolded: tool lines, file cards, subagent rows. */
export function ChatWorkIcon({
  units,
  render,
}: {
  units: FoldedUnit[];
  render: (unit: FoldedUnit) => React.ReactNode;
}) {
  return (
    <ChatHoverCard
      icon={<Wrench />}
      label="Ses outils"
      width={620}
      content={() => <div className="chat-peek-tools">{units.map(render)}</div>}
    />
  );
}
