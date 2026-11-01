import { createContext } from "react";
import type { ActionButton, ToolbarButton } from "@/types";

/**
 * The prompt bar's buttons from the settings (`promptButtons`): the chat's
 * « Commandes » menu offers them (the user's ask of 01/11/2026), App gives
 * them without threading them through every pane.
 */
export const PromptButtonsContext = createContext<ToolbarButton[]>([]);

/** A menu's sections: the root's buttons first, then one per folder, nested ones flattened. */
export interface CommandSection {
  title: string | null;
  buttons: ActionButton[];
}

export function commandSections(
  buttons: readonly ToolbarButton[],
): CommandSection[] {
  const byOrder = (list: readonly ToolbarButton[]) =>
    [...list].sort((a, b) => a.order - b.order);
  const actions = (list: readonly ToolbarButton[]): ActionButton[] =>
    byOrder(list).flatMap((b) =>
      b.kind === "action" ? [b] : actions(b.children),
    );
  const root: ActionButton[] = byOrder(buttons).flatMap((b) =>
    b.kind === "action" ? [b] : [],
  );
  const folders = byOrder(buttons).flatMap((b) =>
    b.kind === "folder"
      ? [{ title: b.label, buttons: actions(b.children) }]
      : [],
  );
  return [{ title: null, buttons: root }, ...folders].filter(
    (s) => s.buttons.length > 0,
  );
}
