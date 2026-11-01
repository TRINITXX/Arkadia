import { useContext, useEffect, useMemo, useState } from "react";
import { SquareSlash } from "lucide-react";
import { getIcon } from "@/icons";
import {
  commandSections,
  PromptButtonsContext,
} from "@/lib/chat/promptButtonsContext";
import { fitAbove } from "@/lib/chat/fitAbove";
import { useChatLayer } from "@/lib/chat/useChatLayers";
import type { ActionButton } from "@/types";

/**
 * « Commandes » beside the input's other buttons: the prompt bar's buttons
 * of the settings (/commit, /clear, « Fais le », …), as the terminal's bar
 * offers them (the user's ask of 01/11/2026). A button set to send goes at
 * once, the others land in the input to edit.
 */
export function ChatCommandsMenu({
  onRun,
}: {
  onRun: (button: ActionButton) => void;
}) {
  const buttons = useContext(PromptButtonsContext);
  const sections = useMemo(() => commandSections(buttons), [buttons]);
  const [open, setOpen] = useState(false);
  // Its buttons all gone (settings changed): closed, not open on their return.
  const empty = sections.length === 0;
  useEffect(() => {
    if (empty) setOpen(false);
  }, [empty]);
  // Esc closes the menu, never Claude's turn (`chatLayers`).
  useChatLayer(open && !empty, () => setOpen(false));
  if (empty) return null;
  return (
    <span className="chat-anchor">
      <button
        type="button"
        className={`chat-ib amber${open ? " on" : ""}`}
        title="Commandes (réglages : barre d'invite)"
        aria-label="Commandes"
        aria-expanded={open}
        // The input keeps the focus.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <SquareSlash />
      </button>
      {open && (
        <div
          className="chat-menu chat-commands-menu"
          style={{ right: 0 }}
          ref={fitAbove}
          onMouseLeave={() => setOpen(false)}
        >
          {sections.map((section, i) => (
            <div key={section.title ?? `root${i}`}>
              {section.title && <h6>{section.title}</h6>}
              {section.buttons.map((b) => {
                const Icon = getIcon(b.icon);
                return (
                  <button
                    key={b.id}
                    type="button"
                    title={
                      b.submit
                        ? `Envoie « ${b.command} »`
                        : `Écrit « ${b.command} » dans la saisie`
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpen(false);
                      onRun(b);
                    }}
                  >
                    {Icon ? <Icon /> : <span className="dot" />}
                    {b.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
