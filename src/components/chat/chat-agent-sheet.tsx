import { ArrowLeft, Bot } from "lucide-react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import type { ChatState, Subagent } from "@/lib/chat/chatState";
import { useFollowEnd } from "@/lib/chat/useFollowEnd";

const NONE = new Set<string>();

/**
 * A subagent's own conversation, over the chat, whole: its prompt, each
 * thought and each tool call in order, then its report (the user's ask of
 * 12/11/2026). Opened on an agent at work, it stays at its end as it grows.
 */
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
  const { scrollRef, innerRef, onScroll } = useFollowEnd(
    agent.status === "running",
  );
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
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-col chat-scroll-inner" ref={innerRef}>
          {!conversation ? (
            <div className="chat-older">Chargement de sa conversation…</div>
          ) : conversation.items.length === 0 ? (
            <div className="chat-older">Conversation vide ou introuvable.</div>
          ) : (
            <ChatTimeline
              items={conversation.items}
              unfolded
              // Followed live: a sentence before more work is a step.
              working={agent.status === "running"}
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
