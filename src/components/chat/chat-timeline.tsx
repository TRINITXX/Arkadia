import { memo, useMemo } from "react";
import { CircleHelp, Images } from "lucide-react";
import {
  MarkdownContent,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { ChatAgentRow } from "@/components/chat/chat-agent-row";
import { ChatEditCard } from "@/components/chat/chat-edit-card";
import { ChatPlanCard } from "@/components/chat/chat-plan-card";
import { ChatWorkGroup } from "@/components/chat/chat-work-group";
import {
  groupChatItems,
  messagesOnly as onlyMessages,
  questionAnswers,
} from "@/lib/chat/chatGroups";
import { latestPlan, type ChatItem, type Subagent } from "@/lib/chat/chatState";

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
}: ChatTimelineProps) {
  const units = useMemo(() => {
    const all = groupChatItems(items);
    return messagesOnly ? onlyMessages(all) : all;
  }, [items, messagesOnly]);
  return (
    <>
      {units.map((unit) => {
        switch (unit.kind) {
          case "user":
            return (
              <div key={unit.item.id} className="chat-unit chat-user">
                {unit.item.images > 0 && (
                  <span className="imgs">
                    <Images size={12} /> {unit.item.images} image
                    {unit.item.images > 1 ? "s" : ""}
                  </span>
                )}
                {unit.item.text}
              </div>
            );
          case "text":
            return (
              <div
                key={unit.item.id}
                className={`chat-unit chat-text${unit.item.streaming ? " streaming" : ""}`}
              >
                <div className="reading-md">
                  <MarkdownContent
                    text={unit.item.text || " "}
                    baseDir={cwd}
                    onOpen={onOpen}
                    onToast={onToast}
                  />
                </div>
              </div>
            );
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
          case "work":
            return <ChatWorkGroup key={unit.id} tools={unit.tools} />;
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
    </>
  );
});
