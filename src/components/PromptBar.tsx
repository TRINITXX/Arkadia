import type { ActionButton, ToolbarButton } from "@/types";
import { ActionToolbarButton, FolderToolbarButton } from "@/components/Toolbar";

interface PromptBarProps {
  buttons: ToolbarButton[];
  onRunAction: (button: ActionButton) => void;
  disabled?: boolean;
  /** Background color — matches the active terminal palette. */
  background: string;
}

/**
 * Bottom toolbar, twin of the top `Toolbar` but anchored to the bottom of the
 * content column. Its buttons type (or send) their text into the active Claude
 * pane instead of spawning a shell tab. Only rendered on Claude panes (the
 * caller gates visibility), so folders open upward (`dropup`).
 */
export function PromptBar({
  buttons,
  onRunAction,
  disabled = false,
  background,
}: PromptBarProps) {
  return (
    <div
      className="flex h-9 items-center gap-1 px-2"
      style={{ backgroundColor: background }}
    >
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {buttons.length === 0 && (
          <span className="text-xs text-zinc-600">
            no prompt button — add one in settings
          </span>
        )}
        {[...buttons]
          .sort((a, b) => a.order - b.order)
          .map((b) =>
            b.kind === "folder" ? (
              <FolderToolbarButton
                key={b.id}
                button={b}
                onRunAction={onRunAction}
                disabled={disabled}
                dropup
              />
            ) : (
              <ActionToolbarButton
                key={b.id}
                button={b}
                onRunAction={onRunAction}
                disabled={disabled}
              />
            ),
          )}
      </div>
    </div>
  );
}
