import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, RotateCcw } from "lucide-react";
import { CONVERSATION_CSS } from "@/components/ConversationView";
import { HLJS_CSS } from "@/components/modern/css";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { Lightbox } from "@/components/modern/Lightbox";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatAgentSheet } from "@/components/chat/chat-agent-sheet";
import { ChatAgentsDrawer } from "@/components/chat/chat-agents-drawer";
import { ChatAgentCards } from "@/components/chat/chat-agent-cards";
import { ChatShellsChip } from "@/components/chat/chat-shells-chip";
import { ChatWorkflowCard } from "@/components/chat/chat-workflow-card";
import { useAgentSheet } from "@/lib/chat/useAgentSheet";
import { useDoneAgentsLink } from "@/lib/chat/useDoneAgentsLink";
import { useLiveActivity } from "@/lib/chat/useLiveActivity";
import type { ShellOutput } from "@/lib/chat/useShellOutputs";
import { ChatComposer, type ChatVoice } from "@/components/chat/chat-composer";
import type { ChatDraft } from "@/lib/chat/chatDrafts";
import { followsAfterScroll } from "@/lib/followBottom";
import { useAnyOverlayOpen } from "@/lib/overlays";
import { CHAT_CSS } from "@/components/chat/chat-css";
import { ChatLiveLine } from "@/components/chat/chat-live-line";
import { ChatEditConfirm } from "@/components/chat/chat-edit-confirm";
import { ChatOlderButton } from "@/components/chat/chat-older-button";
import { ChatQuestionSheet } from "@/components/chat/chat-question-sheet";
import { ChatStartup } from "@/components/chat/chat-startup";
import type { StartupPhase } from "@/lib/chat/chatStartup";
import { recallColumn } from "@/lib/chat/chatLive";
import { useColumnMemory } from "@/lib/chat/useColumnMemory";
import { useMessageEdit } from "@/lib/chat/useMessageEdit";
import { useSheetReply } from "@/lib/chat/chatSheetAnswers";
import { ChatElicitationPanel } from "@/components/chat/chat-elicitation-panel";
import { ChatPermissionPanel } from "@/components/chat/chat-permission-panel";
import type { ChatSdkActions } from "@/lib/chat/useChatSdkActions";
import { useRunningHook } from "@/lib/chat/useRunningHook";
import { ChatPlanApproval } from "@/components/chat/chat-plan-approval";
import { ChatQuestionPanel } from "@/components/chat/chat-question-panel";
import { ChatSearchBox } from "@/components/chat/chat-search-box";
import { ChatStatusBar } from "@/components/chat/chat-status-bar";
import { ChatSessionControls } from "@/components/chat/chat-session-controls";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import { chatGallery } from "@/lib/chat/chatImages";
import { folderOf, modelLabel } from "@/lib/chat/chatLabels";
import { createChatLayers } from "@/lib/chat/chatLayers";
import { ChatLayersContext, useLayer } from "@/lib/chat/useChatLayers";
import { liveStep, timedCall } from "@/lib/chat/chatSteps";
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
import { withChoice } from "@/lib/chat/chatVisual";

export interface ChatViewProps {
  state: ChatState;
  /** Subagent conversations loaded so far, by agent id. */
  agents: Record<string, ChatState>;
  cwd: string | null;
  isActive: boolean;
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
  /** The pane: its column's place and its question sheet outlive unmounts. */
  memoryKey?: string;
  /** An empty column's line or welcome (`startupPhase`). */
  startup?: StartupPhase;
  /** « Charger les messages plus anciens »; absent, the old hint shows. */
  onLoadOlder?: () => void;
  /** Ctrl+B: the running Bash commands and subagents go to the background. */
  onBackground?: () => void;
  /** « Arrêter le workflow », a subagent card's stop (`stopTask`). */
  onStopTask?: (taskId: string) => void;
  /** Asks a background shell's output again (`task_output`). */
  onShellOutput?: (taskId: string) => void;
  shellOutputs?: Record<string, ShellOutput>;
  /** Effort, queued message withdrawn, MCP requests, context detail, plugins. */
  sdkActions?: ChatSdkActions;
}

const NO_OUTPUTS: Record<string, ShellOutput> = {};
const NO_AGENTS: Subagent[] = [];

/** A foreground call Ctrl+B can send to the background, as the terminal hints. */
const BACKGROUNDABLE = new Set(["Bash", "PowerShell", "Agent", "Task"]);

/** The chat pane's face ("Colonne calme"): column, live line, input card, status line. */
export function ChatView({
  state,
  agents,
  cwd,
  isActive,
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
  memoryKey,
  startup = null,
  onLoadOlder,
  onBackground,
  onStopTask,
  onShellOutput,
  shellOutputs = NO_OUTPUTS,
  sdkActions,
}: ChatViewProps) {
  // « hook … en cours » once one lasts; an MCP server's request waits like a tool's.
  const hook = useRunningHook(state.sdk.hooks);
  const elicitation = state.sdk.elicitations[0];
  const [lightbox, setLightbox] = useState<LightboxContent | null>(null);
  const [drawer, setDrawer] = useState(false);
  // Subagents' and workflow agents' conversations, live while they run.
  const agentSheet = useAgentSheet(state, agents, onOpenAgent);
  // The docked cards and the shells chip, with their ticking clock.
  const live = useLiveActivity(state);
  const finishedAgents = useMemo(
    () => state.subagents.filter((s) => s.status !== "running"),
    [state.subagents],
  );
  // « Agents terminés (N) » a while after the last one ended, not for good.
  const doneLink = useDoneAgentsLink(state.subagents, state.items);
  // The call whose time the live line shows (a foreground agent's own).
  const timed = timedCall(state.liveTools);
  const [stuck, setStuck] = useState(true);
  // Off while its tab is hidden (the pane sized to nothing).
  const [shown, setShown] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  /** `scrollTop` at the last scroll event or stick, for `followsAfterScroll`. */
  const lastTopRef = useRef(0);
  /** The place last read while the column had a size: a hidden tab's pane is
   *  sized to nothing and its scroll falls to 0 (as `ModernConversationView`). */
  const savedTopRef = useRef(0);
  /** A place was read with a size: until then a return keeps the one
   *  `useColumnMemory` puts back (a chat mounted in a hidden tab). */
  const measuredRef = useRef(false);

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
  // A subagent's row opens its conversation, else the finished ones. Two
  // handlers: one given as `onClick` would get the click event as « agent ».
  const { openSheet } = agentSheet;
  const openFinished = useCallback(() => setDrawer(true), []);
  const openAgentRow = useCallback(
    (agent?: Subagent) => (agent ? openSheet(agent) : setDrawer(true)),
    [openSheet],
  );
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
    if (el.clientHeight > 0) {
      savedTopRef.current = el.scrollTop;
      measuredRef.current = true;
    }
  }, []);
  // Back on screen where the reader was: before the effect that keeps the end.
  useColumnMemory(memoryKey, scrollRef, innerRef, stuckRef, leaveBottom);
  // Read at its end (or new): the column draws its last rows first.
  const [tailFirst] = useState(
    () => !memoryKey || recallColumn(memoryKey)?.stuck !== false,
  );
  // The pencil on the user's messages (/rewind, conversation only).
  const edit = useMessageEdit({
    items: state.items,
    actions: slashActions,
    working: state.working,
    request: !!request,
    closed: state.closed,
    onDraft,
    onToast,
  });
  // The question sheet up and open: Claude's message drops its questions.
  const sheetUp = !state.closed && !request && !state.working;
  const sheetReply = useSheetReply(memoryKey, state.items, sheetUp);
  // A field of the sheet takes the dictation: its words show there, not here.
  const [sheetDictates, setSheetDictates] = useState(false);
  // What is open in the pane: Esc closes the latest before it reaches
  // Claude (`chatLayers`). Menus and lists register themselves inside.
  const [layers] = useState(createChatLayers);
  useLayer(layers, drawer, () => setDrawer(false));
  useLayer(layers, !!agentSheet.sheet, agentSheet.close);
  useLayer(layers, search.open, search.close);
  useLayer(layers, !state.closed && !request && !!edit.pending, edit.cancel);
  // Esc with the focus on nothing (a chip clicked) or elsewhere in the pane:
  // the input's own Esc (`ChatComposer`) has handled it already. Armed as
  // Ctrl+F: the pane on screen, no layer of the app over it.
  useEffect(() => {
    if (!isActive || !shown || overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const focused = document.activeElement;
      const inPane = !!focused && !!rootRef.current?.contains(focused);
      if (focused && focused !== document.body && !inPane) return;
      if (layers.closeTop()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, shown, overlayOpen, layers]);
  // New content, or content that grew (an image, a diagram), keeps the
  // column at its end while the reader is there.
  useLayoutEffect(() => {
    if (stuckRef.current) toBottom();
  }, [state.items, state.requests, toBottom]);
  // Any size change re-pins a followed column: its content, and the column
  // itself, which shrinks when what is docked under it grows (agent cards,
  // workflow card, panels, notices above the input).
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const scroller = scrollRef.current;
    if (!inner || !scroller) return;
    let wasHidden = scroller.clientHeight === 0;
    // A wide visual takes the pane's width, not the column's (`.chat-visual.wide`).
    const lane = () => {
      if (scroller.clientWidth > 0)
        scroller.style.setProperty("--chat-lane", `${scroller.clientWidth}px`);
    };
    lane();
    const ro = new ResizeObserver(() => {
      lane();
      if (scroller.clientHeight === 0) {
        wasHidden = true;
        return;
      }
      if (stuckRef.current) toBottom();
      // Back from a hidden tab: the reader's place, not the top.
      else if (wasHidden && measuredRef.current) {
        scroller.scrollTop = savedTopRef.current;
        lastTopRef.current = scroller.scrollTop;
      }
      wasHidden = false;
    });
    ro.observe(inner);
    ro.observe(scroller);
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
    // Sized to nothing (its tab hidden): the scroll falling to 0 is no reader.
    if (!el || el.clientHeight === 0) return;
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
    savedTopRef.current = el.scrollTop;
    measuredRef.current = true;
    stuckRef.current = follows;
    setStuck(follows);
  };

  const answer = (result: PermissionResult) => {
    if (request) onAnswer(request.requestId, result);
  };
  // A visual's choice goes into the input, never sent: the user can add a
  // comment. A second click changes the pick (`withChoice`).
  const lastChoice = useRef<string | null>(null);
  // Read when a choice comes: the pane's `onActivate` is a new arrow each
  // render, and a `choose` that changed with it would draw the whole column
  // again on every render (`ChatTimeline` is memoised).
  const activateRef = useRef(onActivate);
  useLayoutEffect(() => {
    activateRef.current = onActivate;
  });
  const choose = useCallback(
    (text: string) => {
      // Read now: the updater runs later, after the ref holds this choice.
      const previous = lastChoice.current;
      lastChoice.current = text;
      onDraft((d) => ({ ...d, text: withChoice(d.text, text, previous) }));
      // A click in a frame doesn't reach the pane: it becomes the active one here.
      activateRef.current();
      requestAnimationFrame(() =>
        rootRef.current
          ?.querySelector<HTMLTextAreaElement>(".chat-box textarea")
          ?.focus(),
      );
    },
    [onDraft],
  );

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
          isActive={isActive}
          subagents={state.subagents}
          onAnswer={answer}
        />
      </div>
    );
  } else if (elicitation) {
    bottom = (
      <div className="chat-box ask">
        <ChatElicitationPanel
          key={elicitation.requestId}
          request={elicitation}
          isActive={isActive}
          onAnswer={(result) =>
            sdkActions?.answerElicitation(elicitation.requestId, result)
          }
        />
      </div>
    );
  } else {
    bottom = (
      <ChatComposer
        items={state.items}
        working={state.working}
        mode={state.mode}
        slash={{
          commands: state.commands,
          names: state.slashCommands,
          sessionId: state.sessionId,
          actions: slashActions,
        }}
        draft={draft}
        onDraft={onDraft}
        voice={sheetDictates ? { ...voice, interim: undefined } : voice}
        focusKey={isActive}
        active={isActive && shown}
        onSend={(text, images, now) => {
          stuckRef.current = true;
          onSend(text, images, now);
        }}
        onInterrupt={onInterrupt}
        onBackground={onBackground}
        onMode={onMode}
        messagesOnly={messagesOnly}
        onMessagesOnly={onMessagesOnly}
        onToast={onToast}
        suggestion={state.suggestion}
        onOpen={open}
      />
    );
  }

  const view = (
    <div className="chat-root" ref={rootRef} onMouseDown={onActivate}>
      <style>
        {CONVERSATION_CSS}
        {HLJS_CSS}
        {CHAT_CSS}
        {search.css}
      </style>
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
          <ChatOlderButton
            truncated={state.historyTruncated}
            cursor={state.historyCursor}
            scrollRef={scrollRef}
            onLoad={onLoadOlder}
          />
          <ChatStartup
            phase={startup}
            actions={slashActions}
            onToast={onToast}
          />
          <ChatTimeline
            items={state.items}
            cwd={cwd}
            subagents={state.subagents}
            pendingToolIds={pendingToolIds}
            messagesOnly={messagesOnly}
            onOpenAgents={openAgentRow}
            onOpen={open}
            onToast={onToast}
            // A queued message's « Envoyer maintenant »: the turn stops, and
            // Claude Code takes what waits at once.
            onSendNow={state.closed ? undefined : onInterrupt}
            onEditMessage={edit.onEdit}
            editBlocked={edit.blocked}
            bareReplyId={sheetReply}
            tailFirst={tailFirst}
            onRemoveQueued={state.closed ? undefined : sdkActions?.removeQueued}
            onReloadPlugins={sdkActions?.reloadPlugins}
            visuals={state.visuals}
            onVisualHtml={sdkActions?.visualHtml}
            onChoose={choose}
            onOpenVisual={sdkActions?.openVisual}
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
              request || elicitation
                ? "attend ta réponse"
                : liveStep(state.liveTools, state.livePhase, cwd)
            }
            // The running call's own time: « lance pnpm test · 42 s ».
            stepSince={request ? null : (timed?.startedAt ?? null)}
            backgroundHint={
              !request &&
              !!onBackground &&
              !!timed &&
              !timed.agent &&
              BACKGROUNDABLE.has(timed.name)
            }
            turnStartedAt={state.turnStartedAt}
            // Thinking ticks before its real count comes (`thinking_tokens`).
            turnTokens={state.turnTokens + state.thinkingTokens}
            subagents={doneLink ? finishedAgents : NO_AGENTS}
            tasks={tasks}
            onOpenAgents={openFinished}
            retry={state.retry}
            hook={hook}
          />
          {!state.closed && !request && edit.pending && (
            <ChatEditConfirm
              later={edit.pending.later}
              going={edit.going}
              onConfirm={edit.confirm}
              onCancel={edit.cancel}
            />
          )}
          {sheetUp && memoryKey && (
            <ChatQuestionSheet
              paneKey={memoryKey}
              items={state.items}
              voice={voice}
              onDictating={setSheetDictates}
              onSend={(text) => {
                stuckRef.current = true;
                onSend(text, []);
              }}
            />
          )}
          <ChatAgentCards
            agents={live.cards}
            cwd={cwd}
            now={live.now}
            onOpen={agentSheet.openSheet}
            onStop={onStopTask}
          />
          {live.workflow && (
            <ChatWorkflowCard
              key={live.workflow.taskId}
              workflow={live.workflow}
              now={live.now}
              onOpenAgent={agentSheet.openWorkflowAgent}
              onStop={onStopTask}
            />
          )}
          {bottom}
          <div className="chat-status-row">
            <ChatStatusBar
              state={state}
              onContextDetail={sdkActions?.contextDetail}
              onMcpOpen={sdkActions?.refreshMcp}
              controls={
                <ChatSessionControls
                  mode={state.mode}
                  model={state.model}
                  sdk={state.sdk}
                  onMode={onMode}
                  onModel={onModel}
                  onEffort={sdkActions?.setEffort}
                />
              }
            />
            <ChatShellsChip
              shells={live.shells}
              commands={live.commands}
              outputs={shellOutputs}
              now={live.now}
              onOutput={onShellOutput}
            />
          </div>
        </div>
      </div>
      {drawer && (
        <ChatAgentsDrawer
          subagents={finishedAgents}
          onOpenConversation={(agent) => {
            agentSheet.openSheet(agent);
            setDrawer(false);
          }}
          onClose={() => setDrawer(false)}
        />
      )}
      {agentSheet.sheet && (
        <ChatAgentSheet
          agent={agentSheet.sheet}
          conversation={agentSheet.conversation}
          cwd={cwd}
          onClose={agentSheet.close}
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
  // Its menus, lists and sheets register their Esc here (`useChatLayer`).
  return (
    <ChatLayersContext.Provider value={layers}>
      {view}
    </ChatLayersContext.Provider>
  );
}
