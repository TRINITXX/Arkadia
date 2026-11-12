import { useMemo, useState } from "react";
import { agentSnapshot, currentAgent } from "@/lib/chat/chatAgentView";
import type { ChatState, Subagent } from "@/lib/chat/chatState";

/**
 * The agent a sheet is open on, as it is now (`currentAgent`), on the
 * desktop and the iPhone. Gone from the chat (its workflow ran again without
 * it), it stays as it was last seen: the snapshot it falls back on follows
 * its status (`agentSnapshot`), so one that ended reads as it ended.
 */
export function useCurrentAgent(
  state: Pick<ChatState, "subagents" | "workflows">,
  opened: Subagent | null,
): Subagent | null {
  const [kept, setKept] = useState(opened);
  // Another agent's sheet, or none: its own snapshot (set while rendering,
  // React's way of keeping what an earlier render saw).
  const mine = kept?.taskId === opened?.taskId;
  if (!mine) setKept(opened);
  const base = mine ? kept : opened;
  const { subagents, workflows } = state;
  const agent = useMemo(
    () => (base ? currentAgent({ subagents, workflows }, base) : null),
    [base, subagents, workflows],
  );
  if (agent && base && agentSnapshot(base, agent) !== base) setKept(agent);
  return agent;
}
