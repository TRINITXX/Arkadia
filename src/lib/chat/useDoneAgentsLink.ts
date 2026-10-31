import { useEffect, useMemo, useState } from "react";
import type { ChatItem, Subagent } from "@/lib/chat/chatState";
import { doneAgentsUntil } from "@/lib/chat/chatTasks";

/**
 * Whether the live line shows « Agents terminés (N) » (`doneAgentsUntil`):
 * one timer to its end, set again when another subagent ends or the user
 * writes, cleared on unmount.
 */
export function useDoneAgentsLink(
  subagents: Subagent[],
  items: ChatItem[],
): boolean {
  const until = useMemo(
    () => doneAgentsUntil(subagents, items),
    [subagents, items],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    // The clock stood still since the last end.
    setNow(Date.now());
    // At least `until`: a timer firing a hair early would never hide it.
    const id = window.setTimeout(
      () => setNow(Math.max(Date.now(), until)),
      Math.max(0, until - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [until]);
  return until !== null && now < until;
}
