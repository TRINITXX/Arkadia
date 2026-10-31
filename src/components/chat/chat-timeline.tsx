import { memo, startTransition, useEffect, useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import {
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
import { ChatNoticeRow } from "@/components/chat/chat-notice-row";
import { ChatPlanCard } from "@/components/chat/chat-plan-card";
import { ChatPluginErrors } from "@/components/chat/chat-plugin-errors";
import { ChatProseContexts } from "@/components/chat/chat-prose-contexts";
import { ChatQueuedMark } from "@/components/chat/chat-queued-mark";
import { ChatWorkGroup } from "@/components/chat/chat-work-group";
import {
  groupChatItems,
  messagesOnly as onlyMessages,
  questionAnswers,
} from "@/lib/chat/chatGroups";
import { withDayBreaks } from "@/lib/chat/chatDays";
import { chatGallery } from "@/lib/chat/chatImages";
import { latestPlan, type ChatItem, type Subagent } from "@/lib/chat/chatState";
import { turnDoneLine } from "@/lib/chat/chatSteps";
import { copiedCodeMessage } from "@/lib/codeCopy";
import type { ImageRef } from "@/lib/imageGallery";

const NO_IMAGES: ImageRef[] = [];

/** Rows a long chat draws first when it comes back (`tailFirst`). */
const TAIL_ROWS = 40;

type UserItem = Extract<ChatItem, { kind: "user" }>;

interface ChatTimelineProps {
  items: ChatItem[];
  cwd: string | null;
  subagents: Subagent[];
  /** Tool calls a pending request is about (its question or plan). */
  pendingToolIds: Set<string>;
  /** « Messages seuls » (`messagesOnly` in `chatGroups`). */
  messagesOnly?: boolean;
  /** With its agent: that one's conversation; without: the finished ones. */
  onOpenAgents: (agent?: Subagent) => void;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
  /** Stops the turn so Claude takes the queued messages now. */
  onSendNow?: () => void;
  /** A pencil on the user's messages; absent while Claude works. */
  onEditMessage?: (item: UserItem) => void;
  /** Mounted on a long chat read at its end: its last rows first, the rest
   *  just after, in the background (a return to the project stays instant). */
  tailFirst?: boolean;
  /** × on a queued message: withdrawn before Claude takes it (its uuid). */
  onRemoveQueued?: (uuid: string) => void;
  /** « Recharger » under plugins that failed to load. */
  onReloadPlugins?: () => void;
}

/** The uuid the chat server sent a message under (`sent:<uuid>`). */
const sentUuid = (id: string) =>
  id.startsWith("sent:") ? id.slice("sent:".length) : null;

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
  onEditMessage,
  tailFirst = false,
  onRemoveQueued,
  onReloadPlugins,
}: ChatTimelineProps) {
  const remover = (item: { id: string; queued?: boolean }) => {
    const uuid = item.queued ? sentUuid(item.id) : null;
    return uuid && onRemoveQueued ? () => onRemoveQueued(uuid) : undefined;
  };
  const units = useMemo(() => {
    const all = groupChatItems(items);
    const shown = messagesOnly ? onlyMessages(all, pendingToolIds) : all;
    // « Aujourd'hui », « Hier », « lun. 27 oct. » where the day changes.
    return withDayBreaks(shown, (u) =>
      "item" in u ? u.item.at : u.kind === "work" ? u.tools[0]?.at : undefined,
    );
  }, [items, messagesOnly, pendingToolIds]);
  const [whole, setWhole] = useState(!tailFirst);
  useEffect(() => {
    if (!whole) startTransition(() => setWhole(true));
  }, [whole]);
  const drawn = whole ? units : units.slice(-TAIL_ROWS);
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
    <ChatProseContexts codeCopy={codeCopy}>
      {drawn.map((unit) => {
        switch (unit.kind) {
          case "day":
            return (
              <div key={unit.id} className="chat-day" role="separator">
                <span>{unit.label}</span>
              </div>
            );
          case "user":
            return (
              <ChatMessageFrame
                key={unit.item.id}
                role="user"
                at={unit.item.at}
                text={unit.item.text}
                className={`chat-user${unit.item.queued ? " queued" : ""}`}
                onToast={onToast}
                onEdit={
                  onEditMessage && !unit.item.queued && !unit.item.dropped
                    ? () => onEditMessage(unit.item)
                    : undefined
                }
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
                    removed={unit.item.removed}
                    onSendNow={onSendNow}
                    onRemove={remover(unit.item)}
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
                cut={unit.item.aborted}
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
            return unit.item.action === "reload_plugins" ? (
              <ChatPluginErrors
                key={unit.item.id}
                item={unit.item}
                onReload={onReloadPlugins}
              />
            ) : (
              <ChatNoticeRow key={unit.item.id} item={unit.item} />
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
                onRemove={remover(unit.item)}
              />
            );
          case "work":
            return <ChatWorkGroup key={unit.id} tools={unit.tools} cwd={cwd} />;
          case "edit":
            return (
              <ChatEditCard
                key={unit.item.id}
                tool={unit.item}
                cwd={cwd}
                onToast={onToast}
              />
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
    </ChatProseContexts>
  );
});
