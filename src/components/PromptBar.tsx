import { useEffect, useState } from "react";
import type { ActionButton, ToolbarButton } from "@/types";
import { ActionToolbarButton, FolderToolbarButton } from "@/components/Toolbar";
import { isNearBottom, REVEAL_ZONE_PX } from "@/lib/promptBarReveal";

interface PromptBarProps {
  buttons: ToolbarButton[];
  onRunAction: (button: ActionButton) => void;
  disabled?: boolean;
  /** Background color — matches the active terminal palette. */
  background: string;
  /** Render as a translucent floating pill instead of a full-width bar. */
  floating?: boolean;
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
  floating = false,
}: PromptBarProps) {
  return (
    <div
      className={
        floating
          ? "chrome-surface flex h-9 items-center gap-1 rounded-lg border border-zinc-800/70 px-2 shadow-lg backdrop-blur-sm"
          : "chrome-surface flex h-9 items-center gap-1 px-2"
      }
      style={{
        backgroundColor: floating
          ? `color-mix(in srgb, ${background} 82%, transparent)`
          : background,
      }}
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

interface FloatingPromptBarProps extends PromptBarProps {
  /** The (relative-positioned) pane host the bar floats over and watches for hover. */
  hostRef: React.RefObject<HTMLElement | null>;
}

/**
 * The prompt bar as a floating overlay pinned to the bottom of the pane host.
 * It stays out of the flex flow so the terminal keeps its full height, and only
 * reveals when the cursor nears the bottom edge — the terminal's own last line
 * (Claude's input box) is therefore never covered at rest.
 */
export function FloatingPromptBar({
  hostRef,
  ...barProps
}: FloatingPromptBarProps) {
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Capture phase: the terminal may stopPropagation on mousemove in mouse mode,
    // so a bubbling listener could never see it. Only setState on transitions.
    const onMove = (e: MouseEvent) => {
      const next = isNearBottom(
        host.getBoundingClientRect(),
        e.clientX,
        e.clientY,
        REVEAL_ZONE_PX,
      );
      setReveal((prev) => (prev === next ? prev : next));
    };
    const onLeave = () => setReveal(false);
    host.addEventListener("mousemove", onMove, true);
    host.addEventListener("mouseleave", onLeave);
    return () => {
      host.removeEventListener("mousemove", onMove, true);
      host.removeEventListener("mouseleave", onLeave);
    };
  }, [hostRef]);

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center transition-[opacity,transform] duration-150 ${
        reveal
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <div className={reveal ? "pointer-events-auto mb-2" : "mb-2"}>
        <PromptBar {...barProps} floating />
      </div>
    </div>
  );
}
