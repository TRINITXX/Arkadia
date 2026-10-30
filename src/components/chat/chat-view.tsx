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
import { CHAT_CSS } from "@/components/chat/chat-css";
import { ChatLiveLine } from "@/components/chat/chat-live-line";
import { ChatModeToggle } from "@/components/chat/chat-mode-toggle";
import { ChatPermissionPanel } from "@/components/chat/chat-permission-panel";
import { ChatPlanApproval } from "@/components/chat/chat-plan-approval";
import { ChatQuestionPanel } from "@/components/chat/chat-question-panel";
import { ChatStatusBar } from "@/components/chat/chat-status-bar";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import { folderOf, modelLabel } from "@/lib/chat/chatLabels";
import type { PermissionMode, PermissionResult } from "@/lib/chat/chatProtocol";
import {
  latestPlan,
  tasksOf,
  type ChatState,
  type Subagent,
} from "@/lib/chat/chatState";
import type { ChatImage } from "@/lib/chat/useChatSession";

export interface ChatViewProps {
  state: ChatState;
  /** Subagent conversations loaded so far, by agent id. */
  agents: Record<string, ChatState>;
  cwd: string | null;
  isActive: boolean;
  switching: boolean;
  onSwitchToTerminal: () => void;
  onActivate: () => void;
  onSend: (text: string, images: ChatImage[]) => void;
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
  /** The pane stopped showing (its tab hidden): nothing on screen any more. */
  onHidden?: () => void;
  onToast?: ToastFn;
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
  onHidden,
  onToast,
}: ChatViewProps) {
  const [lightbox, setLightbox] = useState<LightboxContent | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState<Subagent | null>(null);
  const [stuck, setStuck] = useState(true);
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
      if (width === 0 && height === 0) onHiddenRef.current?.();
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
    const follows = followsAfterScroll(
      stuckRef.current,
      el.scrollTop,
      lastTopRef.current,
      gap,
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
          plan={latestPlan(state.items)}
          cwd={cwd}
          onAnswer={answer}
          onMode={onMode}
          onOpen={open}
          onToast={onToast}
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
        working={state.working}
        mode={state.mode}
        model={state.model}
        slashCommands={state.slashCommands}
        draft={draft}
        onDraft={onDraft}
        voice={voice}
        focusKey={isActive}
        onSend={(text, images) => {
          stuckRef.current = true;
          onSend(text, images);
        }}
        onInterrupt={onInterrupt}
        onMode={onMode}
        onModel={onModel}
      />
    );
  }

  return (
    <div className="chat-root" ref={rootRef} onMouseDown={onActivate}>
      <style>
        {CONVERSATION_CSS}
        {HLJS_CSS}
        {CHAT_CSS}
      </style>
      <ChatModeToggle
        mode="chat"
        busy={switching}
        onSwitch={onSwitchToTerminal}
      />
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
            onOpenAgents={openAgents}
            onOpen={open}
            onToast={onToast}
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
          gallery={[]}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
