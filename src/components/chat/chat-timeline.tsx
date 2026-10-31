import { memo, useMemo } from "react";
import { CircleHelp } from "lucide-react";
import {
  CodeCopyContext,
  MarkdownContent,
  type CodeCopyListener,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { ChatAgentRow } from "@/components/chat/chat-agent-row";
import { ChatCommandCard } from "@/components/chat/chat-command-card";
import { ChatEditCard } from "@/components/chat/chat-edit-card";
import { ChatGallery } from "@/components/chat/chat-gallery";
import { ChatMessageFrame } from "@/components/chat/chat-message-frame";
import { ChatPlanCard } from "@/components/chat/chat-plan-card";
import { ChatQueuedMark } from "@/components/chat/chat-queued-mark";
import { ChatWorkGroup } from "@/components/chat/chat-work-group";
import {
  groupChatItems,
  messagesOnly as onlyMessages,
  questionAnswers,
} from "@/lib/chat/chatGroups";
import { chatGallery } from "@/lib/chat/chatImages";
import { latestPlan, type ChatItem, type Subagent } from "@/lib/chat/chatState";
import { turnDoneLine } from "@/lib/chat/chatSteps";
import { copiedCodeMessage } from "@/lib/codeCopy";
import type { ImageRef } from "@/lib/imageGallery";

const NO_IMAGES: ImageRef[] = [];

interface ChatTimelineProps {
  items: ChatItem[];
  cwd: string | null;
  subagents: Subagent[];
  /** Tool calls a pending request is about (its question or plan). */
  pendingToolIds: Set<string>;
  /** « Messages seuls » (`messagesOnly` in `chatGroups`). */
  messagesOnly?: boolean;
  onOpenAgents: () => void;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
  /** Stops the turn so Claude takes the queued messages now. */
  onSendNow?: () => void;
}

/** The conversation, as the column shows it (see `groupChatItems`). */
export const ChatTimeline = memo(function ChatTimeline({
  items,
  cwd,
  subagents,
  pendingToolIds,
  messagesOnly = false,
  onOpenAgents,
  onOpen,
  onToast,
  onSendNow,
}: ChatTimelineProps) {
  const units = useMemo(() => {
    const all = groupChatItems(items);
    return messagesOnly ? onlyMessages(all, pendingToolIds) : all;
  }, [items, messagesOnly, pendingToolIds]);
  const gallery = useMemo(() => chatGallery(items, cwd), [items, cwd]);
  // A code block's copy toasts here (the reading view's stays silent).
  const codeCopy = useMemo<CodeCopyListener>(
    () => ({
      copied: (code) => onToast?.("info", copiedCodeMessage(code)),
      failed: (e) => onToast?.("error", `Copie impossible : ${String(e)}`),
    }),
    [onToast],
  );
  return (
    <CodeCopyContext.Provider value={codeCopy}>
      {units.map((unit) => {
        switch (unit.kind) {
          case "user":
            return (
              <ChatMessageFrame
                key={unit.item.id}
                role="user"
                at={unit.item.at}
                text={unit.item.text}
                className={`chat-user${unit.item.queued ? " queued" : ""}`}
                onToast={onToast}
              >
                {unit.item.text && (
                  <div className="reading-md" data-chat-prose="">
                    <MarkdownContent
                      text={unit.item.text}
                      baseDir={cwd}
                      onOpen={onOpen}
                      onToast={onToast}
                      inlineImages={false}
                    />
                  </div>
                )}
                <ChatGallery
                  refs={gallery.byItem.get(unit.item.id) ?? NO_IMAGES}
                  dropped={unit.item.images - (unit.item.pasted?.length ?? 0)}
                  onOpen={onOpen}
                />
                {(unit.item.queued || unit.item.dropped) && (
                  <ChatQueuedMark
                    dropped={unit.item.dropped}
                    onSendNow={onSendNow}
                  />
                )}
              </ChatMessageFrame>
            );
          case "text":
            return (
              <ChatMessageFrame
                key={unit.item.id}
                role="claude"
                at={unit.item.at}
                text={unit.item.text}
                error={unit.item.error}
                className={`chat-text${unit.item.streaming ? " streaming" : ""}`}
                onToast={onToast}
              >
                <div className="reading-md" data-chat-prose="">
                  <MarkdownContent
                    text={unit.item.text || " "}
                    baseDir={cwd}
                    onOpen={onOpen}
                    onToast={onToast}
                    inlineImages={false}
                  />
                </div>
                <ChatGallery
                  refs={gallery.byItem.get(unit.item.id) ?? NO_IMAGES}
                  onOpen={onOpen}
                />
              </ChatMessageFrame>
            );
          case "turn": {
            const line = turnDoneLine(
              {
                durationMs: unit.item.durationMs,
                endedAt: unit.item.at ?? 0,
                tools: unit.item.tools,
                files: unit.item.files,
              },
              messagesOnly,
            );
            return line ? (
              <div key={unit.item.id} className="chat-unit chat-done">
                {line}
              </div>
            ) : null;
          }
          case "thinking":
            return (
              <div key={unit.item.id} className="chat-unit chat-text">
                <div
                  className="reading-md"
                  style={{ color: "var(--chat-mute)", fontStyle: "italic" }}
                >
                  {unit.item.text}
                </div>
              </div>
            );
          case "notice":
            return (
              <div
                key={unit.item.id}
                className={`chat-unit chat-notice${unit.item.tone === "error" ? " error" : ""}`}
              >
                {unit.item.text}
              </div>
            );
          case "command":
            return (
              <ChatCommandCard
                key={unit.item.id}
                item={unit.item}
                cwd={cwd}
                onOpen={onOpen}
                onToast={onToast}
                onSendNow={onSendNow}
              />
            );
          case "work":
            return <ChatWorkGroup key={unit.id} tools={unit.tools} cwd={cwd} />;
          case "edit":
            return (
              <ChatEditCard key={unit.item.id} tool={unit.item} cwd={cwd} />
            );
          case "agent":
            return (
              <ChatAgentRow
                key={unit.item.id}
                tool={unit.item}
                agent={subagents.find((s) => s.toolUseId === unit.item.id)}
                onOpen={onOpenAgents}
              />
            );
          case "question": {
            const answers = questionAnswers(unit.item);
            if (pendingToolIds.has(unit.item.id) || answers.length === 0) {
              return (
                <div key={unit.item.id} className="chat-unit chat-line static">
                  <CircleHelp />
                  <b>Question</b>
                  <span>
                    ·{" "}
                    {pendingToolIds.has(unit.item.id)
                      ? "en attente de ta réponse"
                      : "sans réponse"}
                  </span>
                </div>
              );
            }
            return (
              <div key={unit.item.id} className="chat-unit chat-qa">
                {answers.map(([q, a]) => (
                  <div key={q}>
                    <div className="q">{q}</div>
                    <div className="a">→ {a}</div>
                  </div>
                ))}
              </div>
            );
          }
          case "plan": {
            const at = items.findIndex((i) => i.id === unit.item.id);
            return (
              <ChatPlanCard
                key={unit.item.id}
                tool={unit.item}
                plan={latestPlan(items.slice(0, at + 1))}
                pending={pendingToolIds.has(unit.item.id)}
                cwd={cwd}
                onOpen={onOpen}
                onToast={onToast}
              />
            );
          }
        }
      })}
    </CodeCopyContext.Provider>
  );
});
