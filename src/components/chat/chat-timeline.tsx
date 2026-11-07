import { memo, startTransition, useEffect, useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import {
  MarkdownContent,
  type CodeCopyListener,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { ChatAgentRow } from "@/components/chat/chat-agent-row";
import { ChatBashCard } from "@/components/chat/chat-bash-card";
import { ChatCommandCard } from "@/components/chat/chat-command-card";
import { ChatEditCard } from "@/components/chat/chat-edit-card";
import { ChatMessageFrame } from "@/components/chat/chat-message-frame";
import { ChatNoticeRow } from "@/components/chat/chat-notice-row";
import { ChatHandoffRow } from "@/components/chat/chat-handoff-row";
import { ChatPlanCard } from "@/components/chat/chat-plan-card";
import { ChatPluginErrors } from "@/components/chat/chat-plugin-errors";
import { ChatProseContexts } from "@/components/chat/chat-prose-contexts";
import { ChatQueuedMark } from "@/components/chat/chat-queued-mark";
import { ChatThumbStrip } from "@/components/chat/chat-read-thumbs";
import { ChatReplyText } from "@/components/chat/chat-reply-text";
import { ChatStepReply } from "@/components/chat/chat-step-reply";
import { ChatThoughtBulb } from "@/components/chat/chat-thought-bulb";
import { ChatWorkIcon } from "@/components/chat/chat-work-icon";
import { ChatActivityLine } from "@/components/chat/chat-activity-line";
import { ChatUserBody } from "@/components/chat/chat-user-body";
import { ChatVisualCard } from "@/components/chat/chat-visual-card";
import { ChatWorkGroup } from "@/components/chat/chat-work-group";
import { ChatLiveThought } from "@/components/chat/chat-live-thought";
import {
  activityTools,
  foldActivity,
  groupChatItems,
  messagesOnly as onlyMessages,
  questionAnswers,
  stepReplyIds,
  type ChatUnit,
  type FoldedUnit,
} from "@/lib/chat/chatGroups";
import { withDayBreaks } from "@/lib/chat/chatDays";
import {
  chatGallery,
  drawnImageKeys,
  lineImagePaths,
  toolImagePath,
  withToolImages,
} from "@/lib/chat/chatImages";
import { peerLabel } from "@/lib/chat/chatPeer";
import { latestPlan, type ChatItem, type Subagent } from "@/lib/chat/chatState";
import { placeWork } from "@/lib/chat/chatWorkPlaces";
import type { VisualEntry } from "@/lib/chat/chatVisual";
import { turnDoneLine } from "@/lib/chat/chatSteps";
import { copiedCodeMessage } from "@/lib/codeCopy";
import type { ImageRef } from "@/lib/imageGallery";
import { imagePathKey } from "@/lib/imagePaths";

const NO_IMAGES: ImageRef[] = [];
const NO_VISUALS: Record<string, VisualEntry> = {};
/** No reply bare: the sheet is down. */
const NO_BARE: readonly string[] = [];

/** The images the tools behind a wrench look at or make. */
const workImagePaths = (units: FoldedUnit[], cwd: string | null) =>
  lineImagePaths(activityTools(units), (t) => toolImagePath(t, cwd));

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
  /** A subagent row's conversation (a row whose agent isn't known has none). */
  onOpenAgents: (agent: Subagent) => void;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
  /** Stops the turn so Claude takes the queued messages now. */
  onSendNow?: () => void;
  /** A pencil on the user's messages (absent without a chat server). */
  onEditMessage?: (item: UserItem) => void;
  /** Why the pencil can't act now (Claude works…): dim, said on hover. */
  editBlocked?: string | null;
  /** Claude's reply whose questions the sheet shows: drawn without them. */
  bareReplyIds?: readonly string[];
  /** Mounted on a long chat read at its end: its last rows first, the rest
   *  just after, in the background (a return to the project stays instant). */
  tailFirst?: boolean;
  /** × on a queued message: withdrawn before Claude takes it (its uuid),
   *  then gone from the column and back in the input (`chatLive`). */
  onRemoveQueued?: (uuid: string) => void;
  /** « Recharger » under plugins that failed to load. */
  onReloadPlugins?: () => void;
  /** Claude's visuals' pages and checks (`ChatState.visuals`). */
  visuals?: Record<string, VisualEntry>;
  /** A past visual's page with its images in, asked of the server. */
  onVisualHtml?: (toolUseId: string) => void;
  /** A visual's choice: into the input, not sent. */
  onChoose?: (text: string) => void;
  onOpenVisual?: (html: string, title: string) => void;
  /** A running `!` command's stop, by its server id. */
  onStopBash?: (id: string) => void;
  /** Claude's turn under way: its last reply is a step until it ends. */
  working?: boolean;
  /** A handoff's « Reprendre l'ancienne en entier »: the old session resumed. */
  onResumeOld?: (sessionId: string) => void;
}

/** A unit's time for the day breaks; a gathered one's, its first known. */
const unitAt = (u: ChatUnit): number | undefined =>
  u.kind === "activity"
    ? u.units.map(unitAt).find((at) => at !== undefined)
    : u.kind === "thoughts"
      ? u.items.find((i) => i.at !== undefined)?.at
      : "item" in u
        ? u.item.at
        : u.tools.find((t) => t.at !== undefined)?.at;

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
  editBlocked = null,
  bareReplyIds = NO_BARE,
  tailFirst = false,
  onRemoveQueued,
  onReloadPlugins,
  visuals = NO_VISUALS,
  onVisualHtml,
  onChoose,
  onOpenVisual,
  onStopBash,
  working = false,
  onResumeOld,
}: ChatTimelineProps) {
  const remover = (item: { id: string; queued?: boolean }) => {
    const uuid = item.queued ? sentUuid(item.id) : null;
    return uuid && onRemoveQueued ? () => onRemoveQueued(uuid) : undefined;
  };
  const { units, steps, places } = useMemo(() => {
    const all = groupChatItems(items);
    const shown = foldActivity(
      messagesOnly ? onlyMessages(all, pendingToolIds) : all,
    );
    return {
      // « Aujourd'hui », « Hier », « lun. 27 oct. » where the day changes.
      units: withDayBreaks(shown, unitAt),
      // Read on the whole column: « Messages seuls » hides the work.
      steps: stepReplyIds(foldActivity(all), working),
      // Thinking and tools behind Claude's replies (« Récit »).
      places: placeWork(shown, working),
    };
  }, [items, messagesOnly, pendingToolIds, working]);
  const [whole, setWhole] = useState(!tailFirst);
  useEffect(() => {
    if (!whole) startTransition(() => setWhole(true));
  }, [whole]);
  const drawn = whole ? units : units.slice(-TAIL_ROWS);
  const gallery = useMemo(() => chatGallery(items, cwd), [items, cwd]);
  // The images Claude's tools look at or make, on the line of the reply
  // they go behind, in view without opening its wrench (the user's ask of
  // 07/11/2026).
  const lineImages = useMemo(() => {
    const byReply = new Map<string, string[]>();
    for (const [id, units] of places.tools) {
      const paths = workImagePaths(units, cwd);
      if (paths.length > 0) byReply.set(id, paths);
    }
    return byReply;
  }, [places, cwd]);
  // A whole reply's: in its strip, its foot of icons showing on hover only.
  const replyRefs = (id: string): ImageRef[] => {
    const refs = gallery.byItem.get(id) ?? NO_IMAGES;
    const tools = lineImages.get(id);
    return tools ? withToolImages(refs, tools) : refs;
  };
  // A code block's copy toasts here (the reading view's stays silent).
  const codeCopy = useMemo<CodeCopyListener>(
    () => ({
      copied: (code) => onToast?.("info", copiedCodeMessage(code)),
      failed: (e) => onToast?.("error", `Copie impossible : ${String(e)}`),
    }),
    [onToast],
  );
  // A reply's icons: its thinking, and its tools (all but the line under
  // way); on a step's line (`stepText`), its tools' images after them, but
  // those its sentence already shows as minis.
  const peeks = (id: string, stepText?: string): React.ReactNode => {
    const thoughts = places.thoughts.get(id);
    const tools = places.tools.get(id);
    if (!thoughts && !tools) return null;
    let shots = stepText === undefined ? undefined : lineImages.get(id);
    if (shots && stepText) {
      const drawn = drawnImageKeys(stepText, cwd);
      shots = shots.filter((p) => !drawn.has(imagePathKey(p)));
    }
    return (
      <>
        {thoughts && <ChatThoughtBulb items={thoughts} />}
        {tools && <ChatWorkIcon units={tools} render={renderUnit} />}
        {shots && <ChatThumbStrip paths={shots} imagesOnly />}
      </>
    );
  };
  const renderUnit = (unit: (typeof drawn)[number]): React.ReactNode => {
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
            editBlocked={editBlocked}
          >
            <ChatUserBody
              item={unit.item}
              cwd={cwd}
              refs={gallery.byItem.get(unit.item.id) ?? NO_IMAGES}
              onOpen={onOpen}
              onToast={onToast}
            />
            {(unit.item.queued || unit.item.dropped) && (
              <ChatQueuedMark
                dropped={unit.item.dropped}
                onSendNow={onSendNow}
                onRemove={remover(unit.item)}
              />
            )}
          </ChatMessageFrame>
        );
      case "peer":
        return (
          <ChatMessageFrame
            key={unit.item.id}
            role="peer"
            label={peerLabel(unit.item, subagents)}
            at={unit.item.at}
            text={unit.item.text}
            className="chat-peer"
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
          </ChatMessageFrame>
        );
      case "text":
        // A reply that only says what Claude does next: a quiet line, so
        // the one that ends the turn stands out (`stepReplyIds`).
        if (steps.has(unit.item.id))
          return (
            <ChatStepReply
              key={unit.item.id}
              text={unit.item.text}
              bare={bareReplyIds.includes(unit.item.id)}
              past={!places.current.has(unit.item.id)}
              peeks={peeks(unit.item.id, unit.item.text)}
              cwd={cwd}
              onOpen={onOpen}
              onToast={onToast}
            />
          );
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
            peeks={peeks(unit.item.id)}
          >
            <ChatReplyText
              text={unit.item.text}
              bare={bareReplyIds.includes(unit.item.id)}
              cwd={cwd}
              refs={replyRefs(unit.item.id)}
              onOpen={onOpen}
              onToast={onToast}
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
      // Never at the top since `foldActivity` gathers it into `thoughts`;
      // kept for the switch to stay whole.
      case "thinking":
        return null;
      // « Récit » (the user's picks of 02/11/2026): the latest thought in
      // full while Claude works, the others behind the bulb of the reply
      // they led to (`placeWork`), or a bulb of their own.
      case "thoughts":
        if (unit.id === places.live)
          return <ChatLiveThought key={unit.id} items={unit.items} />;
        return places.alone.has(unit.id) ? (
          <div key={unit.id} className="chat-unit chat-peek-alone">
            <ChatThoughtBulb items={unit.items} />
          </div>
        ) : null;
      case "notice":
        return unit.item.action === "reload_plugins" ? (
          <ChatPluginErrors
            key={unit.item.id}
            item={unit.item}
            onReload={onReloadPlugins}
          />
        ) : unit.item.handoff ? (
          <ChatHandoffRow
            key={unit.item.id}
            item={unit.item}
            cwd={cwd}
            onOpen={onOpen}
            onToast={onToast}
            onResumeOld={onResumeOld}
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
      case "bash":
        return (
          <ChatBashCard
            key={unit.item.id}
            item={unit.item}
            onStop={
              onStopBash && unit.item.id.startsWith("bash:")
                ? () => onStopBash(unit.item.id.slice("bash:".length))
                : undefined
            }
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
      case "visual":
        return (
          <ChatVisualCard
            key={unit.item.id}
            tool={unit.item}
            entry={visuals[unit.item.id]}
            onNeedHtml={onVisualHtml}
            onChoose={onChoose}
            onOpenInBrowser={onOpenVisual}
          />
        );
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
      // Claude's tools: the line under way shown, the others behind the
      // wrench of the reply that announced them (« Récit », the user's
      // picks of 02/11/2026), or a wrench of their own.
      case "activity":
        if (places.current.has(unit.id))
          return (
            <ChatActivityLine
              key={unit.id}
              units={unit.units}
              cwd={cwd}
              render={renderUnit}
            />
          );
        return places.alone.has(unit.id) ? (
          <div key={unit.id} className="chat-unit chat-peek-alone">
            <ChatWorkIcon units={unit.units} render={renderUnit} />
            <ChatThumbStrip
              paths={workImagePaths(unit.units, cwd)}
              imagesOnly
            />
          </div>
        ) : null;
    }
  };
  return (
    <ChatProseContexts codeCopy={codeCopy} onOpen={onOpen}>
      {drawn.map(renderUnit)}
    </ChatProseContexts>
  );
});
