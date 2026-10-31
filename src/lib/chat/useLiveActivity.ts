import { useEffect, useMemo, useState } from "react";
import { shellCommands } from "@/lib/chat/chatAgentView";
import type { ChatState } from "@/lib/chat/chatState";
import { agentCards, runningShells, workflowCard } from "@/lib/chat/chatTasks";

/** The cards' clocks move by the second. */
const TICK_MS = 1_000;

/**
 * What runs beside Claude's turn, for the docked cards and the shells chip,
 * with a clock that ticks while any of it shows (a card that ended leaves
 * on a tick, `CARD_LINGER_MS` later).
 */
export function useLiveActivity(state: ChatState) {
  const [now, setNow] = useState(() => Date.now());
  const cards = useMemo(
    () => agentCards(state.subagents, now),
    [state.subagents, now],
  );
  const workflow = useMemo(
    () => workflowCard(state.workflows, now),
    [state.workflows, now],
  );
  const shells = useMemo(() => runningShells(state.shells), [state.shells]);
  const commands = useMemo(
    () => shellCommands(shells, state.items, state.agentMessages),
    [shells, state.items, state.agentMessages],
  );
  const ticking =
    cards.length > 0 || workflow !== undefined || shells.length > 0;
  useEffect(() => {
    if (!ticking) return;
    // The clock stood still while nothing showed.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [ticking]);
  return { now, cards, workflow, shells, commands };
}
