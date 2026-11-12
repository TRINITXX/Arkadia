import { useEffect, useRef } from "react";
import { readAtEnd } from "@/lib/chat/chatAgentView";

/**
 * A subagent's sheet fed by its transcript (a workflow's agent, a resumed
 * session's) reads it once more when the agent ends, on the desktop and the
 * iPhone: read every 2 s only while it runs, it kept the transcript of just
 * before its end, without its report (`readAtEnd`).
 */
export function useReadAtEnd(
  taskId: string | undefined,
  running: boolean,
  /** The sheet may ask now, by its caller's own rule: not fed live, and
   *  its tab shown and its chat not ended (desktop), or its chat readable
   *  (iPhone). */
  ready: boolean,
  read: (taskId: string) => void,
): void {
  /** The agent seen running, until its end is read. */
  const ranRef = useRef<string | null>(null);
  useEffect(() => {
    const next = readAtEnd(ranRef.current, taskId, running, ready);
    ranRef.current = next.ran;
    if (next.read && taskId) read(taskId);
  }, [taskId, running, ready, read]);
}
