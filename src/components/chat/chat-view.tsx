import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RotateCcw } from "lucide-react";
import { CONVERSATION_CSS } from "@/components/ConversationView";
import { HLJS_CSS } from "@/components/modern/css";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { Lightbox } from "@/components/modern/Lightbox";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { ChatAgentSheet } from "@/components/chat/chat-agent-sheet";
import { ChatAgentCards } from "@/components/chat/chat-agent-cards";
import { ChatShellsChip } from "@/components/chat/chat-shells-chip";
import { ChatWorkflowCard } from "@/components/chat/chat-workflow-card";
import { useAgentSheet } from "@/lib/chat/useAgentSheet";
import { runningBash } from "@/lib/chat/chatBash";
import { restsWhileHidden } from "@/lib/chat/chatHiddenView";
import { ChatShownContext } from "@/lib/chat/useChatShown";
import { useWakeOnInput } from "@/lib/chat/useWakeOnInput";
import { useDoneAgentsLink } from "@/lib/chat/useDoneAgentsLink";
import { useLiveActivity } from "@/lib/chat/useLiveActivity";
import type { ShellOutput } from "@/lib/chat/useShellOutputs";
import { ChatComposer, type ChatVoice } from "@/components/chat/chat-composer";
import type { ChatDraft } from "@/lib/chat/chatDrafts";
import { followsAfterScroll } from "@/lib/followBottom";
import { useAnyOverlayOpen } from "@/lib/overlays";
import { CHAT_CSS } from "@/components/chat/chat-css";
import { ChatLiveLine } from "@/components/chat/chat-live-line";
import { ChatMinimap } from "@/components/chat/chat-minimap";
import { useScrollbarGutter } from "@/lib/chat/useScrollbarGutter";
import { warmHiddenVoice } from "@/lib/useHiddenVoice";
import { glideBy, scrollsItself, wheelPixels } from "@/lib/chat/glideScroll";
import { ChatEditConfirm } from "@/components/chat/chat-edit-confirm";
import { ChatOlderButton } from "@/components/chat/chat-older-button";
import { ChatQuestionSheet } from "@/components/chat/chat-question-sheet";
import { ChatStartup } from "@/components/chat/chat-startup";
import type { StartupPhase } from "@/lib/chat/chatStartup";
import { recallColumn } from "@/lib/chat/chatLive";
import { useColumnMemory } from "@/lib/chat/useColumnMemory";
import { useMessageEdit } from "@/lib/chat/useMessageEdit";
import {
  foldNextSheet,
  updateSheet,
  useSheetReply,
} from "@/lib/chat/chatSheetAnswers";
import { focusIsFree, focusOf } from "@/lib/chat/chatFocus";
import { ChatElicitationPanel } from "@/components/chat/chat-elicitation-panel";
import { ChatPermissionPanel } from "@/components/chat/chat-permission-panel";
import type { ChatSdkActions } from "@/lib/chat/useChatSdkActions";
import { useRunningHook } from "@/lib/chat/useRunningHook";
import { ChatPlanApproval } from "@/components/chat/chat-plan-approval";
import { ChatQuestionPanel } from "@/components/chat/chat-question-panel";
import { ChatSearchBox } from "@/components/chat/chat-search-box";
import { ChatStatusBar } from "@/components/chat/chat-status-bar";
import { ChatSessionMenu } from "@/components/chat/chat-session-menu";
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

/** After a chat shows, the dictation's Claude Code starts (`warmHiddenVoice`). */
const VOICE_WARM_MS = 5_000;

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
  /**
   * Its tab is hidden: the view stops rendering (`ChatView`'s memo) and its
   * clocks stop (`ChatShownContext`) until it shows again.
   */
  hidden?: boolean;
  /** The chat is asleep and its input changed: Claude Code starts again. */
  onWake?: () => void;
  /** `!command` sent: runs in the tab's folder (`chatBash`). */
  onBash?: (command: string) => void;
  /** Esc or the card's stop on a running `!` command. */
  onStopBash?: (id: string) => void;
}

const NO_OUTPUTS: Record<string, ShellOutput> = {};
const NO_AGENTS: Subagent[] = [];

/** A foreground call Ctrl+B can send to the background, as the terminal hints. */
const BACKGROUNDABLE = new Set(["Bash", "PowerShell", "Agent", "Task"]);

/**
 * The chat pane's face ("Colonne calme"): column, live line, input card,
 * status line. A hidden tab's view keeps its last render: no work per event
 * while nobody sees it, the state read as it is when it shows again; what it
 * was finishing (a dictation, the send after it) still gets through
 * (`restsWhileHidden`).
 */
export const ChatView = memo(ChatViewBody, restsWhileHidden);

function ChatViewBody({
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
  hidden = false,
  onWake,
  onBash,
  onStopBash,
}: ChatViewProps) {
  // « hook … en cours » once one lasts; an MCP server's request waits like a tool's.
  const hook = useRunningHook(state.sdk.hooks);
  const elicitation = state.sdk.elicitations[0];
  const [lightbox, setLightbox] = useState<LightboxContent | null>(null);
  // Off while its tab is hidden (the pane sized to nothing), or said hidden:
  // its clocks stop, here and in its children (`ChatShownContext`).
  const [sized, setSized] = useState(true);
  const shown = sized && !hidden;
  // Subagents' and workflow agents' conversations, live while they run.
  const agentSheet = useAgentSheet(state, agents, onOpenAgent, shown);
  // The docked cards and the shells chip, with their ticking clock.
  const live = useLiveActivity(state, shown);
  const finishedAgents = useMemo(
    () => state.subagents.filter((s) => s.status !== "running"),
    [state.subagents],
  );
  // « Agents terminés (N) » a while after the last one ended, not for good.
  const doneLink = useDoneAgentsLink(state.subagents, state.items);
  // The call whose time the live line shows (a foreground agent's own).
  const timed = timedCall(state.liveTools);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gutter = useScrollbarGutter(scrollRef);
  // The dictation's hidden Claude Code starts a few seconds after a chat
  // shows (not one mounted in a hidden tab): the mic's first click then
  // listens at once.
  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(warmHiddenVoice, VOICE_WARM_MS);
    return () => window.clearTimeout(id);
  }, [shown]);
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
  // A known subagent's conversation: from its row or the live line's menu.
  const { openSheet } = agentSheet;
  // Every image of the conversation, for the lightbox's ←/→.
  const gallery = useMemo(
    () => (lightbox ? chatGallery(state.items, cwd).all : []),
    [lightbox, state.items, cwd],
  );
  // A match brought into view leaves the end, as the reader's scroll would.
  const leaveBottom = useCallback(() => {
    stuckRef.current = false;
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
  // Asleep: the first change to the input starts Claude Code again.
  useWakeOnInput(state.asleep, draft, onWake);
  const bashId = useMemo(() => runningBash(state.items), [state.items]);
  const stopBash = useMemo(
    () => (bashId && onStopBash ? () => onStopBash(bashId) : undefined),
    [bashId, onStopBash],
  );

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
  // The pencil's message back in the input: the round the rewind shows
  // again opens folded, the input shown with it (`foldNextSheet`).
  const editDraft = useCallback<typeof onDraft>(
    (update) => {
      if (memoryKey) foldNextSheet(memoryKey);
      onDraft(update);
    },
    [memoryKey, onDraft],
  );
  const edit = useMessageEdit({
    items: state.items,
    actions: slashActions,
    working: state.working,
    request: !!request,
    closed: state.closed,
    onDraft: editDraft,
    onToast,
  });
  // The question sheet up and open: Claude's message drops its questions.
  const sheetUp = !state.closed && !request && !state.working;
  const sheetReply = useSheetReply(memoryKey, state.items, sheetUp);
  // The question sheet unfolded takes the input's place (`sheet-open`).
  const sheetOpen = sheetReply.length > 0;
  // A field of the sheet takes the dictation: its words show there, not here.
  const [sheetDictates, setSheetDictates] = useState(false);
  // The input hidden under the sheet listens no more: its dictation stops,
  // its words land in the draft (anything that hides it stops the mic).
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });
  useEffect(() => {
    const v = voiceRef.current;
    if (
      sheetOpen &&
      !sheetDictates &&
      (v.status === "starting" || v.status === "listening")
    )
      void v.stop();
  }, [sheetOpen, sheetDictates]);
  // Something written to the hidden input (a visual's choice, files
  // dropped): the sheet folds, the input shows it.
  const foldSheet = useCallback(() => {
    if (memoryKey && sheetReply.length > 0)
      updateSheet(memoryKey, sheetReply[0], (s) => ({ ...s, folded: true }));
  }, [memoryKey, sheetReply]);
  const attached = draft.images.length + (draft.files?.length ?? 0);
  const attachedRef = useRef(attached);
  useEffect(() => {
    if (attached > attachedRef.current && sheetOpen) foldSheet();
    attachedRef.current = attached;
  }, [attached, sheetOpen, foldSheet]);
  // The sheet folded or closed by the user: the input takes the focus
  // back, unless it sits elsewhere (search, a visual, another field).
  const [refocus, setRefocus] = useState(0);
  const wasOpenRef = useRef(sheetOpen);
  useEffect(() => {
    if (
      wasOpenRef.current &&
      !sheetOpen &&
      focusIsFree(focusOf(rootRef.current))
    )
      setRefocus((n) => n + 1);
    wasOpenRef.current = sheetOpen;
  }, [sheetOpen]);
  // What is open in the pane: Esc closes the latest before it reaches
  // Claude (`chatLayers`). Menus and lists register themselves inside.
  const [layers] = useState(createChatLayers);
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
      setSized(!hidden);
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
      // The input hidden under the sheet: shown with the choice in it.
      foldSheet();
      // A click in a frame doesn't reach the pane: it becomes the active one here.
      activateRef.current();
      requestAnimationFrame(() =>
        rootRef.current
          ?.querySelector<HTMLTextAreaElement>(".chat-box textarea")
          ?.focus(),
      );
    },
    [onDraft, foldSheet],
  );

  // The session's button, its rings and its shells: in the input's bottom
  // row (the user's pick of 31/10/2026), else on a row of their own.
  const sessionItems = (
    <>
      <ChatSessionMenu
        mode={state.mode}
        model={state.model}
        sdk={state.sdk}
        onMode={onMode}
        onModel={onModel}
        onEffort={sdkActions?.setEffort}
      />
      <ChatStatusBar
        state={state}
        onContextDetail={sdkActions?.contextDetail}
        onMcpOpen={sdkActions?.refreshMcp}
      />
      <ChatShellsChip
        shells={live.shells}
        commands={live.commands}
        outputs={shellOutputs}
        now={live.now}
        onOutput={onShellOutput}
      />
    </>
  );
  let inInput = false;
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
    inInput = true;
    bottom = (
      <ChatComposer
        leading={sessionItems}
        paneKey={memoryKey}
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
        voice={
          sheetDictates
            ? { ...voice, interim: undefined, elsewhere: true }
            : voice
        }
        // Focused when the pane activates, and when the user folds the
        // sheet that hid it (`refocus`, only with the focus free).
        focusKey={isActive ? `focus:${refocus}` : false}
        // Hidden under the unfolded sheet: no typing sent to it.
        active={isActive && shown && !sheetOpen}
        onSend={(text, images, now) => {
          stuckRef.current = true;
          onSend(text, images, now);
        }}
        onBash={
          onBash &&
          ((command) => {
            stuckRef.current = true;
            onBash(command);
          })
        }
        onStopBash={stopBash}
        asleep={state.asleep}
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

  // The wheel anywhere below the conversation (question sheet, input, the
  // room either side of them) scrolls it, unless what's under the pointer
  // scrolls itself that way: no dead zone (the user's reports of 01/11/2026).
  const onRootWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    if (!scroller || e.ctrlKey || e.deltaY === 0) return;
    const target = e.target as Element;
    // The column scrolls natively; a sheet or a lightbox keeps its wheel.
    if (target !== e.currentTarget && !target.closest(".chat-bottom")) return;
    if (scrollsItself(target, e.currentTarget, e.deltaY)) return;
    glideBy(
      scroller,
      wheelPixels(e.deltaY, e.deltaMode, scroller.clientHeight),
    );
  };

  const view = (
    <div
      className="chat-root"
      ref={rootRef}
      onMouseDown={onActivate}
      onWheel={onRootWheel}
    >
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
      {/* A map of the conversation on its right edge (the user's pick 12). */}
      <ChatMinimap
        scrollRef={scrollRef}
        innerRef={innerRef}
        version={state.items}
      />
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
            working={state.working}
            cwd={cwd}
            subagents={state.subagents}
            pendingToolIds={pendingToolIds}
            messagesOnly={messagesOnly}
            // A subagent's row opens its conversation; a row whose agent
            // isn't known takes no click (`ChatAgentRow`).
            onOpenAgents={openSheet}
            onOpen={open}
            onToast={onToast}
            // A queued message's « Envoyer maintenant »: the turn stops, and
            // Claude Code takes what waits at once.
            // Held behind a running `!` command, it goes when the command
            // ends: stopping Claude's turn wouldn't send it. × still withdraws it.
            onSendNow={state.closed || bashId ? undefined : onInterrupt}
            onEditMessage={edit.onEdit}
            editBlocked={edit.blocked}
            bareReplyIds={sheetReply}
            tailFirst={tailFirst}
            onRemoveQueued={state.closed ? undefined : sdkActions?.removeQueued}
            onReloadPlugins={sdkActions?.reloadPlugins}
            visuals={state.visuals}
            onVisualHtml={sdkActions?.visualHtml}
            onChoose={choose}
            onOpenVisual={sdkActions?.openVisual}
            onStopBash={onStopBash}
          />
        </div>
      </div>
      <div
        className={`chat-bottom${sheetOpen ? " sheet-open" : ""}`}
        // The scrollbar's width on the right: the same column as above.
        style={gutter > 0 ? { paddingRight: gutter } : undefined}
      >
        <div className="chat-col" style={{ position: "relative" }}>
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
            onOpenAgent={openSheet}
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
              active={isActive && shown}
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
          {!inInput && <div className="chat-status-row">{sessionItems}</div>}
        </div>
      </div>
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
  // Its menus, lists and sheets register their Esc here (`useChatLayer`),
  // its clocks ask whether it shows (`useChatShown`).
  return (
    <ChatLayersContext.Provider value={layers}>
      <ChatShownContext.Provider value={shown}>
        {view}
      </ChatShownContext.Provider>
    </ChatLayersContext.Provider>
  );
}
