import { MessageSquare, SquareTerminal } from "lucide-react";

const TOGGLE_CSS = `
.chat-toggle { position: absolute; top: 10px; right: 14px; z-index: 8; display: flex; gap: 2px; padding: 2px; border-radius: 9px; background: #18181b; border: 1px solid #27272a; font-size: 12px; }
.chat-toggle button { display: flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 7px; border: 0; background: transparent; color: #a1a1aa; cursor: pointer; font: inherit; font-size: 12px; }
.chat-toggle button.on { background: #27272a; color: #fafafa; cursor: default; }
.chat-toggle button:disabled:not(.on) { opacity: .5; cursor: default; }
.chat-toggle .lucide { width: 13px; height: 13px; }
`;

/**
 * Chat / Terminal, at the pane's top right: the same conversation goes from
 * one to the other (Claude restarts in a few seconds).
 */
export function ChatModeToggle({
  mode,
  busy,
  onSwitch,
}: {
  mode: "chat" | "terminal";
  /** A switch is under way, or Claude can't be moved right now. */
  busy?: boolean;
  onSwitch: () => void;
}) {
  return (
    <div className="chat-toggle">
      <style>{TOGGLE_CSS}</style>
      <button
        type="button"
        className={mode === "chat" ? "on" : undefined}
        disabled={mode === "chat" || busy}
        title="Chat"
        onClick={onSwitch}
      >
        <MessageSquare /> <span className="lbl">Chat</span>
      </button>
      <button
        type="button"
        className={mode === "terminal" ? "on" : undefined}
        disabled={mode === "terminal" || busy}
        title="Terminal"
        onClick={onSwitch}
      >
        <SquareTerminal /> <span className="lbl">Terminal</span>
      </button>
    </div>
  );
}
