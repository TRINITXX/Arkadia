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
import { ChatChromeChip } from "@/components/chat/chat-chrome-chip";
import { ChatWorkflowCard } from "@/components/chat/chat-workflow-card";
import { useAgentSheet } from "@/lib/chat/useAgentSheet";
import { runningBash } from "@/lib/chat/chatBash";
import { restsWhileHidden } from "@/lib/chat/chatHiddenView";
import { ChatShownContext } from "@/lib/chat/useChatShown";
import {
  ChatDictationContext,
  type ChatDictation,
} from "@/lib/chat/useFieldDictation";
import { useWakeOnInput } from "@/lib/chat/useWakeOnInput";
import { useDoneAgentsLink } from "@/lib/chat/useDoneAgentsLink";
import { useLiveActivity } from "@/lib/chat/useLiveActivity";
import type { ShellOutput } from "@/lib/chat/useShellOutputs";
import {
  ChatComposer,
  type ChatVoice,
  type KeepLock,
} from "@/components/chat/chat-composer";
import { useAccountLabel } from "@/lib/accountQuota";
import { paneAccountId } from "@/lib/accounts";
import { CREDITS_ACCOUNT_ID } from "@/lib/creditsAccount";
import {
  keepChoiceIn,
  lastChoiceIn,
  type ChatDraft,
} from "@/lib/chat/chatDrafts";
import { followsAfterScroll } from "@/lib/followBottom";

import {
  createScrollFold,
  FOLD_CLOSE_MS,
  FOLD_OPEN_MS,
  foldRoomLeft,
  followsInRoom,
  openingRoom,
  roomToKeep,
  ScrollFoldContext,
  scrollFoldEvent,
  wheelAtEnd,
} from "@/lib/chat/scrollFold";
import { useAnyOverlayOpen } from "@/lib/overlays";
import { CHAT_CSS } from "@/components/chat/chat-css";
import { ChatLiveLine } from "@/components/chat/chat-live-line";
import { ChatMinimap } from "@/components/chat/chat-minimap";
import { useScrollbarGutter } from "@/lib/chat/useScrollbarGutter";
import { warmHiddenVoice } from "@/lib/useHiddenVoice";
import { glideBy, scrollsItself, wheelPixels } from "@/lib/chat/glideScroll";
import { ChatEditConfirm } from "@/components/chat/chat-edit-confirm";
import { ChatLimitBanner } from "@/components/chat/chat-limit-banner";
import { ChatOlderButton } from "@/components/chat/chat-older-button";
import { ChatQuestionSheet } from "@/components/chat/chat-question-sheet";
import { lastReplyRound, roundShowsNow } from "@/lib/chat/chatQuestionRound";
import { ChatStartup } from "@/components/chat/chat-startup";
import type { StartupPhase } from "@/lib/chat/chatStartup";
import { recallColumn } from "@/lib/chat/chatLive";
import { useColumnMemory } from "@/lib/chat/useColumnMemory";
import { useMessageEdit } from "@/lib/chat/useMessageEdit";
import {
  foldNextSheet,
  updateSheet,
  sheetScrollFolded,
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
import { withChoiceImages, type ChoiceImage } from "@/lib/chat/chatVisual";

/** A sheet's render and last frame may lag behind its fold or unfold this long. */
const MOTION_SLACK_MS = 150;

/** After a chat shows, the dictation's Claude Code starts (`warmHiddenVoice`). */
const VOICE_WARM_MS = 5_000;

export interface ChatViewProps {
  state: ChatState;
  /** The pane's id: its Chrome window, when Claude drives one. */
  paneId: string;
  /** The pane's account: the week's card names it, with Fable's share. */
  accountId?: string;
  /** Subagent conversations loaded so far, by agent id. */
  agents: Record<string, ChatState>;
  cwd: string | null;
  isActive: boolean;
  onActivate: () => void;
  /** `now`: Claude Code ends the turn under way for it. */
  onSend: (text: string, images: ChatImage[], now?: boolean) => void;
  onInterrupt: () => void;
  /** `images`: pasted into an AskUserQuestion's own words. */
  onAnswer: (
    requestId: string,
    result: PermissionResult,
    images?: ChatImage[],
  ) => void;
  onMode: (mode: PermissionMode) => void;
  onModel: (model: string) => void;
  onOpenAgent: (agentId: string) => void;
  onRestart: () => void;
  /** The input's text and images: they outlive the card while a request
   *  takes its place, and dictation adds to them. */
  draft: ChatDraft;
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>;
  voice: ChatVoice;
  /** Its lock (`PaneChat.keepAccount`): the account it keeps at the limit. */
  keepAccount?: string;
  /** The lock clicked; absent, no lock. */
  onKeepAccount?: (on: boolean) => void;
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
  onWake?: (slash: boolean) => void;
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
  paneId,
  accountId,
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
  keepAccount,
  onKeepAccount,
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
  // Every image of the conversation, for the lightbox's ←/→; a visual's
  // image walks its own page's.
  const gallery = useMemo(
    () =>
      !lightbox
        ? []
        : lightbox.kind === "image" && lightbox.gallery
          ? lightbox.gallery
          : chatGallery(state.items, cwd).all,
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

  // The question sheets fold as the reader scrolls up and unfold at the end
  // (`scrollFold`). Room under the conversation keeps it still meanwhile:
  // the pane's height a sheet frees would else pull it down by as much.
  const [scrollFold] = useState(createScrollFold);
  const foldRoomRef = useRef(0);
  /**
   * Until when the room holds as it is: a sheet in motion (its render a
   * task away, then its height moving) frees the pane's height frame by
   * frame, and a trim against a height not yet freed would let the fold
   * clamp the column after all. It settles once the sheet stands.
   */
  const roomHeldUntilRef = useRef(0);
  const setFoldRoom = useCallback((px: number) => {
    if (px === foldRoomRef.current) return;
    foldRoomRef.current = px;
    innerRef.current?.style.setProperty("--chat-fold-room", `${px}px`);
  }, []);
  /** The room trimmed to what keeps the view still (it only shrinks out of view). */
  const trimFoldRoom = useCallback(
    (el: HTMLElement) => {
      if (foldRoomRef.current > 0)
        setFoldRoom(
          foldRoomLeft(
            foldRoomRef.current,
            el.scrollTop,
            el.clientHeight,
            el.scrollHeight,
          ),
        );
    },
    [setFoldRoom],
  );
  /** The reader down at the end: a sheet the scroll folded opens, the end followed. */
  const foldAtEnd = () => {
    if (scrollFold.emit("end")) stuckRef.current = true;
  };

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
  // A sheet starts opening, before its render: room under the column for
  // all it may take back (its questions, the height it rises by), so the
  // layout never clamps the column; the resizes trim it. What is left once
  // it stands goes, the end gliding down to it.
  const settleRoom = useCallback(() => {
    const el = scrollRef.current;
    if (performance.now() < roomHeldUntilRef.current) return;
    if (!el || foldRoomRef.current === 0) return;
    if (!stuckRef.current) {
      trimFoldRoom(el);
      return;
    }
    // Following the end, what is left goes at once: the opening gave it
    // back frame by frame already (`openingRoom`), a pixel or two at most.
    setFoldRoom(0);
    toBottom();
  }, [setFoldRoom, trimFoldRoom, toBottom]);
  /** The room held while a sheet moves (`roomHeldUntilRef`), settled after. */
  const holdRoom = useCallback(
    (ms: number) => {
      const until = performance.now() + ms + MOTION_SLACK_MS;
      roomHeldUntilRef.current = Math.max(roomHeldUntilRef.current, until);
      window.setTimeout(settleRoom, ms + MOTION_SLACK_MS + 16);
    },
    [settleRoom],
  );
  /**
   * A sheet opening: the column's height then, and the room that kept the
   * text's place as it starts (its first resize), for `openingRoom`.
   */
  const openingRef = useRef<{ client: number; start: number | null } | null>(
    null,
  );
  useEffect(() => {
    scrollFold.setOnOpening(() => {
      const el = scrollRef.current;
      openingRef.current = el ? { client: el.clientHeight, start: null } : null;
      holdRoom(FOLD_OPEN_MS);
    });
    return () => scrollFold.setOnOpening(null);
  }, [scrollFold, holdRoom]);
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
  // The one up at rest stays while Claude works again, its send queued like
  // any message (the user's choice of 02/11/2026: a subagent's report woke
  // Claude and the sheet vanished under his finger); one born mid-turn
  // waits for its end, never covering an input in use (`roundShowsNow`).
  const roundId = useMemo(
    () => lastReplyRound(state.items)?.id ?? null,
    [state.items],
  );
  const sheetUp =
    !state.closed &&
    !request &&
    (!state.working || roundShowsNow(true, roundId, state.restRound));
  const sheetReply = useSheetReply(memoryKey, state.items, sheetUp);
  // The question sheet unfolded takes the input's place (`sheet-open`).
  const sheetOpen = sheetReply.length > 0;
  // A field of the sheet takes the dictation: its words show there, not here.
  const [sheetDictates, setSheetDictates] = useState(false);
  // So does a visual's remark or the « Autre réponse » of Claude's questions.
  const [fieldDictates, setFieldDictates] = useState(false);
  const dictation = useMemo<ChatDictation | null>(
    () =>
      memoryKey
        ? { paneKey: memoryKey, voice, onElsewhere: setFieldDictates }
        : null,
    [memoryKey, voice],
  );
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
  // Written to while a scroll folded it: that fold is the user's now, the
  // column's end leaves it (`keep`), never covering an input in use.
  const foldSheet = useCallback(() => {
    scrollFold.emit("keep");
    if (memoryKey && sheetReply.length > 0)
      updateSheet(memoryKey, sheetReply[0], (s) => ({ ...s, folded: true }));
  }, [memoryKey, sheetReply, scrollFold]);
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
      // Folded by the reader's scroll: he reads, the input waits for a use.
      !(memoryKey && sheetScrollFolded(memoryKey)) &&
      focusIsFree(focusOf(rootRef.current))
    )
      setRefocus((n) => n + 1);
    wasOpenRef.current = sheetOpen;
  }, [sheetOpen, memoryKey]);
  // The input used (typed in, dictated to) while a scroll's fold shows it:
  // that fold is the user's now (`keep`).
  const draftSize =
    draft.text.length + draft.images.length + (draft.files?.length ?? 0);
  useEffect(() => {
    scrollFold.emit("keep");
  }, [draftSize, scrollFold]);
  const inputListens =
    !sheetDictates &&
    !fieldDictates &&
    (voice.status === "starting" || voice.status === "listening");
  useEffect(() => {
    if (inputListens) scrollFold.emit("keep");
  }, [inputListens, scrollFold]);
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
      if (stuckRef.current) {
        // A sheet opening at the end (the user's ask of 27/11/2026): the
        // text's end glides with it in one motion, from where it was to its
        // place above it. First the room that keeps the place it had (the
        // questions the sheet takes back from its message made the layout
        // clamp the column), then less as the dock grows (`openingRoom`),
        // each frame before it paints. Else the room goes: the end shows.
        const o = openingRef.current;
        if (o && scrollFold.isOpening()) {
          if (o.start === null)
            o.start = Math.max(
              0,
              roomToKeep(
                foldRoomRef.current,
                lastTopRef.current,
                o.client,
                scroller.scrollHeight,
              ),
            );
          setFoldRoom(
            openingRoom(
              o.start,
              o.client - scroller.clientHeight,
              scrollFold.openingGrowth(),
            ),
          );
        } else {
          openingRef.current = null;
          setFoldRoom(0);
        }
        toBottom();
      }
      // Back from a hidden tab: the reader's place, not the top.
      else if (wasHidden && measuredRef.current) {
        scroller.scrollTop = savedTopRef.current;
        lastTopRef.current = scroller.scrollTop;
      }
      // A sheet folded: the room it needs, the rest out of view dropped.
      // A move the layout made (anchoring) is no reader's: absorbed.
      else if (foldRoomRef.current > 0) {
        if (performance.now() >= roomHeldUntilRef.current)
          trimFoldRoom(scroller);
        lastTopRef.current = scroller.scrollTop;
      }
      wasHidden = false;
    });
    ro.observe(inner);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [toBottom, setFoldRoom, trimFoldRoom, scrollFold]);
  // The dock's height as laid out, for a sheet's motion to start from
  // (`useFoldMotion`): it reads the height before its own change, which the
  // observer hears only after.
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    scrollFold.setDockHeight(dock.offsetHeight);
    const ro = new ResizeObserver(() =>
      scrollFold.setDockHeight(dock.offsetHeight),
    );
    ro.observe(dock);
    return () => ro.disconnect();
  }, [scrollFold]);
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
    // A sheet rising at the end took its questions back from its message:
    // the layout clamped the column, upwards onto its end. No reader did:
    // the resize puts the place back (it comes after this event).
    if (
      scrollFold.isOpening() &&
      stuckRef.current &&
      el.scrollTop < lastTopRef.current &&
      gap <= 2
    )
      return;
    // The conversation's end is its last message, never the room under it:
    // coming down into that blank is reaching the end.
    const fold = scrollFoldEvent(
      el.scrollTop,
      lastTopRef.current,
      gap - foldRoomRef.current,
    );
    // In the room a fold kept, only coming down onto the end follows
    // again (`followsInRoom`). Else a search's smooth scroll to a match near
    // the end doesn't follow again; the very end still does (no resume
    // zone, as in the reading view).
    const follows =
      foldRoomRef.current > 0
        ? followsInRoom(
            stuckRef.current,
            el.scrollTop,
            lastTopRef.current,
            fold,
          )
        : followsAfterScroll(
            stuckRef.current,
            el.scrollTop,
            lastTopRef.current,
            gap,
            searching ? 0 : undefined,
          );
    if (performance.now() >= roomHeldUntilRef.current) trimFoldRoom(el);
    // Room for the whole dock before the sheet folds (the next render): the
    // scroll never clamps; the resize trims it to what the fold freed.
    if (fold === "up" && scrollFold.emit("up")) {
      const dock = rootRef.current?.querySelector<HTMLElement>(".chat-bottom");
      setFoldRoom(Math.max(foldRoomRef.current, dock?.offsetHeight ?? 0));
      holdRoom(FOLD_CLOSE_MS);
    }
    lastTopRef.current = el.scrollTop;
    savedTopRef.current = el.scrollTop;
    measuredRef.current = true;
    stuckRef.current = follows;
    if (fold === "end") foldAtEnd();
  };

  const answer = (result: PermissionResult, images?: ChatImage[]) => {
    if (request) onAnswer(request.requestId, result, images);
  };
  // A visual's choice goes into the input, never sent: the user can add a
  // comment. A second click changes the pick (`withChoice`), its remarks'
  // images with it (`withChoiceImages`). Kept with the pane's draft, not by
  // this view: the draft outlives it and moves with it (`lastChoiceIn`).
  // Read when a choice comes: the pane's `onActivate` is a new arrow each
  // render, and a `choose` that changed with it would draw the whole column
  // again on every render (`ChatTimeline` is memoised).
  const activateRef = useRef(onActivate);
  useLayoutEffect(() => {
    activateRef.current = onActivate;
  });
  const choose = useCallback(
    (text: string, images: ChoiceImage[] = []) => {
      // Read now, the key made now (unique, its images' ids): the updater
      // gives the same draft each time it runs (React may run it twice).
      const previous = lastChoiceIn(paneId);
      const key = `choice:${crypto.randomUUID()}`;
      onDraft((d) => {
        const r = withChoiceImages(d, text, images, previous, key);
        keepChoiceIn(paneId, r.put);
        return r.draft;
      });
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
    [onDraft, foldSheet, paneId],
  );

  // The lock beside the microphone: on the credits, only to free the
  // account it goes back to (none to keep there otherwise).
  const onCreditsNow = paneAccountId(accountId) === CREDITS_ACCOUNT_ID;
  const keptLabel = useAccountLabel(onCreditsNow ? keepAccount : accountId);
  const keepLock: KeepLock | null =
    onKeepAccount && (!onCreditsNow || keepAccount)
      ? {
          on: !!keepAccount,
          account: keptLabel ?? "ce compte",
          onToggle: () => onKeepAccount(!keepAccount),
        }
      : null;

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
        accountId={accountId}
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
      <ChatChromeChip paneId={paneId} />
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
    // Its own frame, the questions sheet's (`chat-sheet-q`).
    bottom = (
      <ChatQuestionPanel
        key={request.requestId}
        request={request}
        isActive={isActive}
        onAnswer={answer}
        onOpen={open}
        onToast={onToast}
      />
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
          mcp: sdkActions && {
            servers: state.sdk.mcpServers,
            act: sdkActions.mcpAction,
            refresh: sdkActions.refreshMcp,
          },
        }}
        draft={draft}
        onDraft={onDraft}
        voice={
          sheetDictates || fieldDictates
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
        keepLock={keepLock}
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
    // Down at the end already, no scroll comes: the end is asked all the
    // same, only where the column takes the wheel (not the input, its
    // menus, a sheet, the lightbox), and what scrolls itself keeps it.
    const gap =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const dock = target.closest(".chat-bottom");
    const onColumn =
      target === e.currentTarget ||
      !!target.closest(".chat-scroll, .chat-minimap, .chat-sheet-q.folded") ||
      (!!dock && !target.closest(".chat-box, .chat-sheet-q"));
    if (
      onColumn &&
      wheelAtEnd(e.deltaY, gap) &&
      !scrollsItself(target, e.currentTarget, e.deltaY)
    )
      foldAtEnd();
    // The column scrolls natively; a sheet or a lightbox keeps its wheel.
    // The map on the column's edge too: no dead band where the pointer rests.
    if (
      target !== e.currentTarget &&
      !target.closest(".chat-bottom, .chat-minimap")
    )
      return;
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
        version={state.items.length}
        onLeave={leaveBottom}
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
            onResumeOld={
              slashActions
                ? (id) =>
                    void slashActions
                      .resume(id, { whole: true })
                      .then((why) => why && onToast?.("error", why))
                : undefined
            }
          />
        </div>
      </div>
      <div
        // Claude's question panel, in the sheet's frame, shrinks as the sheet
        // does when what stacks above it fills the pane.
        ref={dockRef}
        className={`chat-bottom${sheetOpen || (!state.closed && request?.toolName === "AskUserQuestion") ? " sheet-open" : ""}`}
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
              working={state.working}
              onDictating={setSheetDictates}
              onOpen={open}
              onToast={onToast}
              onSend={(text, images) => {
                stuckRef.current = true;
                onSend(text, images);
              }}
              onStop={onInterrupt}
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
          {/* The usage limit holds it, no account free: the wait and the
              API credits, just above the input. */}
          <ChatLimitBanner chatId={paneId} />
          {bottom}
          {!inInput && <div className="chat-status-row">{sessionItems}</div>}
        </div>
      </div>
      {agentSheet.sheet && (
        <ChatAgentSheet
          // Another agent's sheet opens at its own place (`useFollowEnd`).
          key={agentSheet.sheet.taskId}
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
  // its clocks ask whether it shows (`useChatShown`), its other fields
  // dictate through it (`useFieldDictation`).
  return (
    <ChatLayersContext.Provider value={layers}>
      <ChatShownContext.Provider value={shown}>
        <ChatDictationContext.Provider value={dictation}>
          <ScrollFoldContext.Provider value={scrollFold}>
            {view}
          </ScrollFoldContext.Provider>
        </ChatDictationContext.Provider>
      </ChatShownContext.Provider>
    </ChatLayersContext.Provider>
  );
}
