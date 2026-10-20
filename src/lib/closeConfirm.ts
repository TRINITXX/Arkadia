import type { Tab } from "@/types";
import type { AgentStateValue } from "./agentState";

/** Text of the confirmation asked before closing tabs where something still
 *  runs — Claude working (orange badge) or a background shell open (blue
 *  ring) — or null when closing cuts nothing off. Read per pane, not from the
 *  tab's aggregate: waiting outranks busy there, so a split with one Claude
 *  working and one waiting would slip through. */
export function closeConfirmMessage(
  tabs: Tab[],
  paneStates: Record<string, AgentStateValue>,
): string | null {
  const states = tabs.flatMap((t) =>
    Object.keys(t.panes).map(
      (paneId) => paneStates[paneId] ?? { kind: "none" },
    ),
  );
  const working = states.some((s) => s.kind === "busy");
  const shell = states.some((s) => s.kind === "waiting" && s.shellRunning);
  if (!working && !shell) return null;
  const where = tabs.length > 1 ? "dans ce projet" : "dans cet onglet";
  if (working) {
    return `Claude travaille encore ${where}. Fermer coupe sa tâche en cours.`;
  }
  return `Un shell tourne encore en arrière-plan ${where}. Fermer quand même ?`;
}
