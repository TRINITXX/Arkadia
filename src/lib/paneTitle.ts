import { stateFromTitle } from "@/lib/agentState";
import type { PaneState } from "@/types";

/**
 * The name a pane shows on its tab: the fixed label its opener gave it
 * (`--tab-add --name`), else its terminal's title. A chat pane always shows
 * its chat's title: the label named the command the pane was opened for.
 */
export function paneTabTitle(pane: PaneState | undefined): string {
  if (!pane) return "";
  if (pane.chat || !pane.label) return pane.title;
  // Claude running in the labelled terminal: its status glyph stays in front,
  // the desktop tab bar has no other sign of its activity.
  const glyph = stateFromTitle(pane.title)
    ? [...pane.title.trimStart()][0]
    : "";
  return glyph ? `${glyph} ${pane.label}` : pane.label;
}
