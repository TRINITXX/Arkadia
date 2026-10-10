import type { Tab } from "@/types";
import { aggregate, isActive, type AgentStateValue } from "./agentState";

// Tabs hidden from the sidebar "Active" list until the next launch (right-click
// → "Masquer jusqu'au prochain redémarrage"). In-memory only: the tab keeps
// running, it just stops being listed. Typing in it, or Claude finishing a
// turn in it, lists it again.

/** Claude state of each tab: the aggregate of its panes (splits). */
export function tabAgentStates(
  tabs: Tab[],
  paneStates: Record<string, AgentStateValue>,
): Record<string, AgentStateValue> {
  const byTab: Record<string, AgentStateValue> = {};
  for (const tab of tabs) {
    byTab[tab.id] = aggregate(
      Object.keys(tab.panes).map(
        (paneId) => paneStates[paneId] ?? { kind: "none" },
      ),
    );
  }
  return byTab;
}

/** How long a pane must keep waiting before its hidden tab comes back. Claude
 *  stamps ✳ in the title as soon as it hands back the prompt, but the count of
 *  background subagents that turns that into "busy" lands a moment later. */
export const REVEAL_ON_WAITING_MS = 2000;

/** Panes whose Claude started or stopped waiting for a reply between two
 *  snapshots. Per pane, not per tab: in a split, a second Claude finishing
 *  while the first already waits leaves the tab's aggregate unchanged. */
export function waitingTransitions(
  prev: Record<string, AgentStateValue>,
  next: Record<string, AgentStateValue>,
): { entered: string[]; left: string[] } {
  const entered: string[] = [];
  const left: string[] = [];
  for (const [paneId, state] of Object.entries(next)) {
    if (state.kind === "waiting" && prev[paneId]?.kind !== "waiting") {
      entered.push(paneId);
    }
  }
  for (const [paneId, state] of Object.entries(prev)) {
    if (state.kind === "waiting" && next[paneId]?.kind !== "waiting") {
      left.push(paneId);
    }
  }
  return { entered, left };
}

/** Active projects still shown under "Active". A project whose listed tabs
 *  (Claude busy or waiting) are all hidden goes back to "Inactive", so its
 *  tabs stay reachable. One the user never hid a tab of is left alone, even
 *  with no listed tab. */
export function visibleActiveProjectIds(
  activeProjectIds: ReadonlySet<string>,
  tabs: Tab[],
  tabStates: Record<string, AgentStateValue>,
  hidden: ReadonlySet<string>,
): ReadonlySet<string> {
  if (hidden.size === 0) return activeProjectIds;
  const visible = new Set<string>();
  for (const projectId of activeProjectIds) {
    const projectTabs = tabs.filter((t) => t.projectId === projectId);
    const hasHidden = projectTabs.some((t) => hidden.has(t.id));
    const hasListed = projectTabs.some(
      (t) => !hidden.has(t.id) && isActive(tabStates[t.id] ?? { kind: "none" }),
    );
    if (!hasHidden || hasListed) visible.add(projectId);
  }
  return visible;
}
