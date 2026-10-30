import { ArrowLeft, Bot } from "lucide-react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import type { ChatState, Subagent } from "@/lib/chat/chatState";

const NONE = new Set<string>();

/** A subagent's own conversation, over the chat, as its transcript holds it. */
export function ChatAgentSheet({
  agent,
  conversation,
  cwd,
  onClose,
  onOpen,
  onToast,
}: {
  agent: Subagent;
  conversation: ChatState | undefined;
  cwd: string | null;
  onClose: () => void;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  return (
    <div className="chat-sheet">
      <div className="sh">
        <button
          type="button"
          className="chat-ib"
          title="Retour"
          onClick={onClose}
          style={{ marginLeft: 0 }}
        >
          <ArrowLeft />
        </button>
        <Bot size={16} />
        <span>{agent.description}</span>
      </div>
      <div className="chat-scroll">
        <div className="chat-col chat-scroll-inner">
          {!conversation ? (
            <div className="chat-older">Chargement de sa conversation…</div>
          ) : conversation.items.length === 0 ? (
            <div className="chat-older">Conversation vide ou introuvable.</div>
          ) : (
            <ChatTimeline
              items={conversation.items}
              cwd={cwd}
              subagents={[]}
              pendingToolIds={NONE}
              onOpenAgents={() => {}}
              onOpen={onOpen}
              onToast={onToast}
            />
          )}
        </div>
      </div>
    </div>
  );
}
