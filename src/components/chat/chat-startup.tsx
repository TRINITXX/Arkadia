import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatWelcome } from "@/components/chat/chat-welcome";
import type { StartupPhase } from "@/lib/chat/chatStartup";
import type { SlashActions } from "@/lib/chat/useSlashActions";

/**
 * An empty column: what is under way (« Claude démarre… », « Reprise de la
 * conversation… »), or, for a new chat, the folder's latest sessions to go on
 * with in one click (`ChatWelcome`).
 */
export function ChatStartup({
  phase,
  actions,
  onToast,
}: {
  phase: StartupPhase;
  actions?: SlashActions;
  onToast?: ToastFn;
}) {
  if (phase === "starting" || phase === "resuming") {
    return (
      <div className="chat-startup" role="status">
        <span className="spin" />
        {phase === "starting"
          ? "Claude démarre…"
          : "Reprise de la conversation…"}
      </div>
    );
  }
  if (phase === "welcome" && actions) {
    return <ChatWelcome actions={actions} onToast={onToast} />;
  }
  return null;
}
