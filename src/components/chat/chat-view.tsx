import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, RotateCcw } from "lucide-react";
import { CONVERSATION_CSS } from "@/components/ConversationView";
import { HLJS_CSS } from "@/components/modern/css";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { Lightbox } from "@/components/modern/Lightbox";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatAgentSheet } from "@/components/chat/chat-agent-sheet";
import { ChatAgentsDrawer } from "@/components/chat/chat-agents-drawer";
import { ChatComposer, type ChatVoice } from "@/components/chat/chat-composer";
import type { ChatDraft } from "@/lib/chat/chatDrafts";
import { followsAfterScroll } from "@/lib/followBottom";
import { useAnyOverlayOpen } from "@/lib/overlays";
import { CHAT_CSS } from "@/components/chat/chat-css";
import { ChatLiveLine } from "@/components/chat/chat-live-line";
import { ChatModeToggle } from "@/components/chat/chat-mode-toggle";
import { ChatPermissionPanel } from "@/components/chat/chat-permission-panel";
import { ChatPlanApproval } from "@/components/chat/chat-plan-approval";
import { ChatQuestionPanel } from "@/components/chat/chat-question-panel";
import { ChatSearchBox } from "@/components/chat/chat-search-box";
import { ChatStatusBar } from "@/components/chat/chat-status-bar";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import { chatGallery } from "@/lib/chat/chatImages";
import { folderOf, modelLabel } from "@/lib/chat/chatLabels";
import { liveStep } from "@/lib/chat/chatSteps";
import { useChatSearch } from "@/lib/chat/useChatSearch";
import type { PermissionMode, PermissionResult } from "@/lib/chat/chatProtocol";
import {
  latestPlan,
  tasksOf,
  type ChatState,
  type Subagent,
} from "@/lib/chat/chatState";
import type { ChatImage } from "@/lib/chat/useChatSession";
import type { SlashActions } from "@/lib/chat/useSlashActions";

export interface ChatViewProps {
  state: ChatState;
  /** Subagent conversations loaded so far, by agent id. */
  agents: Record<string, ChatState>;
  cwd: string | null;
  isActive: boolean;
  switching: boolean;
  onSwitchToTerminal: () => void;
  onActivate: () => void;
  /** `now`: Claude Code ends the turn under way for it. */
  onSend: (text: string, images: ChatImage[], now?: boolean) => void;
  onInterrupt: () => void;
  onAnswer: (requestId: string, result: PermissionResult) => void;
  onMode: (mode: PermissionMode) => void;
  onModel: (model: string) => void;
  onOpenAgent: (agentId: string) => void;
  onRestart: () => void;
  /** The input's text and images: they outlive the card while a request
   *  takes its place, and dictation adds to them. */
  draft: ChatDraft;
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>;
  voice: ChatVoice;
  /** « Messages seuls »: the column shows the user's and Claude's words alone. */
  messagesOnly: boolean;
  onMessagesOnly: (on: boolean) => void;
  /** The pane stopped showing (its tab hidden): nothing on screen any more. */
  onHidden?: () => void;
  onToast?: ToastFn;
  /** What /resume and /rewind ask of the chat (`useSlashActions`). */
  slashActions?: SlashActions;
}

/** The chat pane's face ("Colonne calme"): column, live line, input card, status line. */
export function ChatView({
  state,
  agents,
  cwd,
  isActive,
  switching,
  onSwitchToTerminal,
  onActivate,
  onSend,
  onInterrupt,
  onAnswer,
  onMode,
  onModel,
  onOpenAgent,
  onRestart,
  draft,
  onDraft,
  voice,
  messagesOnly,
  onMessagesOnly,
  onHidden,
  onToast,
  slashActions,
}: ChatViewProps) {
  const [lightbox, setLightbox] = useState<LightboxContent | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState<Subagent | null>(null);
  const [stuck, setStuck] = useState(true);
  // Off while its tab is hidden (the pane sized to nothing).
  const [shown, setShown] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  /** `scrollTop` at the last scroll event or stick, for `followsAfterScroll`. */
  const lastTopRef = useRef(0);

  const tasks = useMemo(() => tasksOf(state.items), [state.items]);
  const request = state.requests[0];
  const pendingToolIds = useMemo(
    () => new Set(state.requests.map((r) => r.toolUseId)),
    [state.requests],
  );
  const open = useCallback(
    (content: LightboxContent) => setLightbox(content),
    [],
  );
  const openAgents = useCallback(() => setDrawer(true), []);
  // Every image of the conversation, for the lightbox's ←/→.
  const gallery = useMemo(
    () => (lightbox ? chatGallery(state.items, cwd).all : []),
    [lightbox, state.items, cwd],
  );
  // A match brought into view leaves the end, as the reader's scroll would.
  const leaveBottom = useCallback(() => {
    stuckRef.current = false;
    setStuck(false);
  }, []);
  // Ctrl+F belongs to the pane on screen: not a hidden tab's active pane,
  // nor one under a layer (sessions, settings, the viewer).
  const overlayOpen = useAnyOverlayOpen();
  const search = useChatSearch(
    scrollRef,
    isActive && shown && !overlayOpen,
    leaveBottom,
  );
  const searching = search.open && search.total > 0;

  const toBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
  }, []);
  // New content, or content that grew (an image, a diagram), keeps the
  // column at its end while the reader is there.
  useLayoutEffect(() => {
    if (stuckRef.current) toBottom();
  }, [state.items, state.requests, toBottom]);
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (stuckRef.current) toBottom();
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [toBottom]);
  // A hidden tab keeps its panes mounted but sized to nothing.
  const onHiddenRef = useRef(onHidden);
  useLayoutEffect(() => {
    onHiddenRef.current = onHidden;
  }, [onHidden]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const hidden = width === 0 && height === 0;
      setShown(!hidden);
      if (hidden) onHiddenRef.current?.();
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  // Only the reader scrolling up leaves the end, never the gap alone: rows
  // sized in by `content-visibility` grow under a still `scrollTop` (REVIEW.md,
  // « Vue lecture arrêtée au-dessus de la fin »).
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    // A search's smooth scroll to a match near the end doesn't follow again;
    // the very end still does (no resume zone, as in the reading view).
    const follows = followsAfterScroll(
      stuckRef.current,
      el.scrollTop,
      lastTopRef.current,
      gap,
      searching ? 0 : undefined,
    );
    lastTopRef.current = el.scrollTop;
    stuckRef.current = follows;
    setStuck(follows);
  };

  const answer = (result: PermissionResult) => {
    if (request) onAnswer(request.requestId, result);
  };

  let bottom: React.ReactNode;
  if (state.closed) {
    bottom = (
      <div className="chat-closed">
        <span>
          Conversation arrêtée
          {state.closed.error ? ` : ${state.closed.error}` : ""}
        </span>
        <button type="button" className="chat-btn" onClick={onRestart}>
          <RotateCcw /> Reprendre
        </button>
      </div>
    );
  } else if (request?.toolName === "AskUserQuestion") {
    bottom = (
      <div className="chat-box ask">
        <ChatQuestionPanel
          key={request.requestId}
          request={request}
          isActive={isActive}
          onAnswer={answer}
        />
      </div>
    );
  } else if (request?.toolName === "ExitPlanMode") {
    bottom = (
      <div className="chat-box ask">
        <ChatPlanApproval
          key={request.requestId}
          request={request}
          hasPlan={latestPlan(state.items) !== null}
          onAnswer={answer}
          onMode={onMode}
        />
      </div>
    );
  } else if (request) {
    bottom = (
      <div className="chat-box ask">
        <ChatPermissionPanel
          key={request.requestId}
          request={request}
          onAnswer={answer}
        />
      </div>
    );
  } else {
    bottom = (
      <ChatComposer
        items={state.items}
        working={state.working}
        mode={state.mode}
        model={state.model}
        slash={{
          commands: state.commands,
          names: state.slashCommands,
          sessionId: state.sessionId,
          actions: slashActions,
        }}
        draft={draft}
        onDraft={onDraft}
        voice={voice}
        focusKey={isActive}
        active={isActive && shown}
        onSend={(text, images, now) => {
          stuckRef.current = true;
          onSend(text, images, now);
        }}
        onInterrupt={onInterrupt}
        onMode={onMode}
        onModel={onModel}
        messagesOnly={messagesOnly}
        onMessagesOnly={onMessagesOnly}
        onToast={onToast}
      />
    );
  }

  return (
    <div className="chat-root" ref={rootRef} onMouseDown={onActivate}>
      <style>
        {CONVERSATION_CSS}
        {HLJS_CSS}
        {CHAT_CSS}
        {search.css}
      </style>
      <ChatModeToggle
        mode="chat"
        busy={switching}
        onSwitch={onSwitchToTerminal}
      />
      {search.open && (
        <ChatSearchBox
          query={search.query}
          total={search.total}
          at={search.at}
          focusKey={search.focusKey}
          onQuery={search.search}
          onStep={search.step}
          onClose={search.close}
        />
      )}
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-col chat-scroll-inner" ref={innerRef}>
          <div className="chat-title">{state.title ?? folderOf(cwd)}</div>
          <div className="chat-meta">
            {[modelLabel(state.model), folderOf(cwd)]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {state.historyTruncated && (
            <div className="chat-older">
              Les messages plus anciens sont dans le terminal.
            </div>
          )}
          <ChatTimeline
            items={state.items}
            cwd={cwd}
            subagents={state.subagents}
            pendingToolIds={pendingToolIds}
            messagesOnly={messagesOnly}
            onOpenAgents={openAgents}
            onOpen={open}
            onToast={onToast}
            // A queued message's « Envoyer maintenant »: the turn stops, and
            // Claude Code takes what waits at once.
            onSendNow={state.closed ? undefined : onInterrupt}
          />
        </div>
      </div>
      <div className="chat-bottom">
        <div className="chat-col" style={{ position: "relative" }}>
          {!stuck && (
            <button
              type="button"
              className="chat-down"
              onClick={() => {
                stuckRef.current = true;
                setStuck(true);
                toBottom();
              }}
            >
              <ArrowDown /> Aller en bas
            </button>
          )}
          <ChatLiveLine
            working={state.working}
            compacting={state.status === "compacting"}
            step={
              // The terminal's dialog hides its spinner; here the line stays.
              request
                ? "attend ta réponse"
                : liveStep(state.liveTools, state.livePhase, cwd)
            }
            turnStartedAt={state.turnStartedAt}
            turnTokens={state.turnTokens}
            subagents={state.subagents}
            tasks={tasks}
            onOpenAgents={openAgents}
          />
          {bottom}
          <ChatStatusBar state={state} />
        </div>
      </div>
      {drawer && (
        <ChatAgentsDrawer
          subagents={state.subagents}
          onOpenConversation={(agent) => {
            onOpenAgent(agent.taskId);
            setSheet(agent);
            setDrawer(false);
          }}
          onClose={() => setDrawer(false)}
        />
      )}
      {sheet && (
        <ChatAgentSheet
          agent={sheet}
          conversation={agents[sheet.taskId]}
          cwd={cwd}
          onClose={() => setSheet(null)}
          onOpen={open}
          onToast={onToast}
        />
      )}
      {lightbox && (
        <Lightbox
          content={lightbox}
          gallery={gallery}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
