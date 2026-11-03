import type {
  ChatEvent,
  JsonObject,
  PermissionAsk,
  PermissionUpdate,
  SlashCommandInfo,
} from "@/lib/chat/chatProtocol";
import {
  addSdkSettings,
  closeSdk,
  EMPTY_SDK,
  reduceSdkEvent,
  type SdkState,
} from "@/lib/chat/chatSdkSettings";
import {
  addCommandSent,
  addHistoryCommand,
  addServerNotice,
  commandAnswer,
  commandList,
  endCommandTurn,
  isCommandSent,
  markCommandStarted,
  resetConversation,
} from "@/lib/chat/chatCommands";
import { resultNotice, type RetryInfo } from "@/lib/chat/chatErrors";
import { startTurn } from "@/lib/chat/chatTurn";
import { peerMessages, type PeerMessage } from "@/lib/chat/chatPeer";
import { addSdkContent, compactNotice } from "@/lib/chat/chatSdkContent";
import {
  addHandoff,
  historyHandoff,
  type NoticeHandoff,
} from "@/lib/chat/chatHandoff";
import { toolDetail, type ToolDetail } from "@/lib/chat/chatToolResult";
import type { VisualEntry } from "@/lib/chat/chatVisual";
import {
  addSubagentMessage,
  addTaskEvent,
  addToolProgress,
  addWorkflowLive,
  historySubagents,
  interruptTasks,
  type BackgroundShell,
  type Workflow,
} from "@/lib/chat/chatTasks";

/**
 * The chat view's state, built from the chat server's events alone (the same
 * events replayed after a page reload rebuild the same state). Pure: `now`
 * comes in with each event.
 */

export type ChatItem = (
  | {
      kind: "user";
      id: string;
      text: string;
      images: number;
      /** The pasted images still kept, as data URLs: the newest
       *  `KEPT_PASTED` of the chat (`keepPasted`); `images` counts them all. */
      pasted?: string[];
      /** The texts it sent from tags (`chatPastes`): tags again in its
       *  frame, on the phone too. Absent from a session read back. */
      pastes?: string[];
      /** Sent while Claude worked and not taken yet (`takeQueued`). */
      queued?: boolean;
      /** Never taken: Claude Code cancelled it, or the chat ended first.
       *  Withdrawn by the user's × (`queued_removed`), it leaves the column. */
      dropped?: boolean;
    }
  | {
      kind: "text";
      id: string;
      text: string;
      streaming: boolean;
      /** An API error Claude Code wrote as Claude's reply. */
      error?: boolean;
      /** Cut by an interrupt before its end (`assistant.aborted`). */
      aborted?: boolean;
    }
  | { kind: "thinking"; id: string; text: string; streaming: boolean }
  /** Another Claude session's message, or a background subagent's
   *  (`chatPeer`): never the user's, so no ↑, no /rewind, no pencil. */
  | {
      kind: "peer";
      id: string;
      /** The sender's name; absent when not said. */
      from?: string;
      /** Sent by a subagent of this session: its task id. */
      agentId?: string;
      text: string;
    }
  /** A finished turn: the « Terminé en » line (`turnDoneLine`). */
  | {
      kind: "turn";
      id: string;
      durationMs: number;
      tools: number;
      files: number;
    }
  | {
      kind: "tool";
      /** The tool_use id: results and permission requests point at it. */
      id: string;
      name: string;
      input: JsonObject;
      /** `detail`: its structured result's diff or streams (`toolDetail`). */
      result?: { text: string; isError: boolean; detail?: ToolDetail };
      /** Read from the transcript without a result: none will ever come, it
       *  is not running (`addHistory`). */
      stale?: boolean;
    }
  | {
      kind: "notice";
      id: string;
      text: string;
      tone: "info" | "warning" | "error";
      /** Claude Code's own words under it (a hook's reason, a refusal's why). */
      detail?: string;
      /** The answer to the user's own command (« n'existe que dans le
       *  terminal », « Nouvelle conversation »): « Messages seuls » keeps it. */
      command?: boolean;
      /** A button under it: plugins that failed load again (`chatSdkSettings`). */
      action?: "reload_plugins";
      /**
       * The separator of a handoff (`chatHandoff`): what is above it, the old
       * session, is greyed. The phone shows its text alone.
       */
      handoff?: NoticeHandoff;
    }
  /** A `!` command of the user and its output (`chat-server/bash.ts`). */
  | {
      kind: "bash";
      id: string;
      command: string;
      stdout: string;
      stderr: string;
      running: boolean;
      /** Bash's exit code; null when stopped or never started, absent from the past. */
      code?: number | null;
      stopped?: boolean;
      /** It couldn't start (no Git Bash…). */
      error?: string;
      /** How much of the output Claude gets, of how much there was. */
      sent?: number;
      total?: number;
    }
  /** A slash command sent, filled by its local answer (`chatCommands`). */
  | {
      kind: "command";
      id: string;
      name: string;
      args: string;
      output?: string;
      /** Claude's text items its answer came in, gone from the column. */
      absorbed: string[];
      /** As a message: waiting for the turn under way, or never taken. */
      queued?: boolean;
      dropped?: boolean;
      /** Claude Code runs it now (`command_lifecycle`): its answer is this card's. */
      running?: boolean;
    }
) & {
  /** When it was said, started or ended (ms); unknown for an old transcript. */
  at?: number;
};

/** A tool call running now, the main loop's or a subagent's. */
export interface LiveTool {
  id: string;
  name: string;
  input: JsonObject;
  agent: boolean;
  /** When it started (ms): the live line's « · 42 s » (`tool_progress` corrects it). */
  startedAt?: number;
}

/** What Claude's current request does while no tool runs (its spinner mode). */
export type LivePhase =
  | "requesting"
  | "thinking"
  | "responding"
  | "tool-input"
  | null;

export interface Subagent {
  taskId: string;
  /** The Agent tool call that started it. */
  toolUseId?: string;
  description: string;
  type?: string;
  /** `interrupted`: still running when its session's Claude Code stopped. */
  status: "running" | "completed" | "failed" | "stopped" | "interrupted";
  toolUses: number;
  tokens: number;
  durationMs: number;
  lastTool?: string;
  summary?: string;
  /** Live only (`chatTasks`): its card's clock, ✓ and last action. */
  startedAt?: number;
  endedAt?: number;
  /** Started or sent to the background: the live set (`background_tasks_changed`) has it. */
  background?: boolean;
  /** Its run (`run_id`): resumed by SendMessage, it keeps its id, gets a new run. */
  runId?: string;
  /** Launched by another subagent: it goes on with that one. */
  parentTaskId?: string;
  lastAction?: { name: string; input: JsonObject };
  /** An API error it is retrying (`tool_progress.subagent_retry`). */
  retry?: { attempt: number; max: number; status?: number };
}

export interface PendingRequest extends PermissionAsk {
  requestId: string;
  toolName: string;
  input: JsonObject;
  toolUseId: string;
  title?: string;
  description?: string;
  suggestions?: PermissionUpdate[];
}

export interface RateWindow {
  /** 0 to 1. */
  utilization: number;
  /** Epoch seconds. */
  resetsAt?: number;
}

export interface ChatState {
  items: ChatItem[];
  sessionId: string | null;
  title: string | null;
  gitBranch: string | null;
  model: string | null;
  mode: string | null;
  slashCommands: string[];
  /** The same with descriptions (`supportedCommands`, `commands_changed`). */
  commands: SlashCommandInfo[];
  working: boolean;
  turnStartedAt: number | null;
  /** The ❓ round up when the turn started (`startTurn`): the one that
   *  stays while Claude works, never one born mid-turn (02/11/2026). */
  restRound: string | null;
  /** Output tokens of the current turn, thinking included. */
  turnTokens: number;
  status: "requesting" | "compacting" | null;
  requests: PendingRequest[];
  subagents: Subagent[];
  /** Background commands and workflows (`chatTasks`): never subagents. */
  shells: BackgroundShell[];
  workflows: Workflow[];
  /** Each live subagent's own messages, by its Agent call: its sheet. */
  agentMessages: Record<string, JsonObject[]>;
  /** Thinking tokens estimated since the last count (`thinking_tokens`). */
  thinkingTokens: number;
  /** 0-100 of the window usable before auto-compact. */
  context: { percentage: number } | null;
  limits: { fiveHour?: RateWindow; sevenDay?: RateWindow };
  historyLoaded: boolean;
  historyTruncated: boolean;
  /** The oldest past message loaded: the next older page ends before it. */
  historyCursor: string | null;
  /** Past messages holding results whose call lies in a page not loaded
   *  yet: an older page that brings the call gets its result from them. */
  historyOrphans: JsonObject[];
  closed: { error?: string } | null;
  /** Streamed block (`<message id>:<index>`) → its item id. */
  streams: Record<string, string>;
  /** Output tokens already counted per API message of the turn. */
  messageTokens: Record<string, number>;
  /** Tool calls running now, in start order: the live line's step. */
  liveTools: LiveTool[];
  livePhase: LivePhase;
  /** The main loop's tool calls since the last turn ended, and the files
   *  they edited: the « Terminé en » line's figures. */
  turnTools: number;
  turnFiles: string[];
  /** A failed request Claude Code sends again: the live line says so. */
  retry: RetryInfo | null;
  /** The next message Claude Code suggests, after a turn (`prompt_suggestion`). */
  suggestion: string | null;
  /** The quota alerts already said, by key (`quotaAlerts`). */
  quotaSeen: string[];
  /** The turn's API error code (`assistant.error`), for its end's notice. */
  apiError: string | null;
  /** The user stopped the turn (Claude Code's « [Request interrupted by
   *  user] »): its end is « Tour interrompu », whatever its reason says. */
  interrupted: boolean;
  /** Models, effort, fast mode, MCP servers and requests, hooks (`chatSdkSettings`). */
  sdk: SdkState;
  /** Claude's visuals (`show_visual`) by tool call: their page and check. */
  visuals: Record<string, VisualEntry>;
  /**
   * Its Claude Code sleeps (nothing ran for the Lab's delay): the column and
   * the figures stay as they were, the empty input says so, a key wakes it.
   */
  asleep: boolean;
  /**
   * A /rewind's cut nothing was sent after yet (`info.rewind`): a restart
   * after the server stopped resumes at it, never on the turns rewound away.
   */
  rewind: { before: string; at: string } | null;
}

export const EMPTY_CHAT: ChatState = {
  items: [],
  sessionId: null,
  title: null,
  gitBranch: null,
  model: null,
  mode: null,
  slashCommands: [],
  commands: [],
  working: false,
  turnStartedAt: null,
  restRound: null,
  turnTokens: 0,
  status: null,
  requests: [],
  subagents: [],
  shells: [],
  workflows: [],
  agentMessages: {},
  thinkingTokens: 0,
  context: null,
  limits: {},
  historyLoaded: false,
  historyTruncated: false,
  historyCursor: null,
  historyOrphans: [],
  closed: null,
  streams: {},
  messageTokens: {},
  liveTools: [],
  livePhase: null,
  turnTools: 0,
  turnFiles: [],
  retry: null,
  suggestion: null,
  quotaSeen: [],
  apiError: null,
  interrupted: false,
  sdk: EMPTY_SDK,
  visuals: {},
  asleep: false,
  rewind: null,
};

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
/** A pasted image's label sent before it (« [Image #2] »): no line of the message. */
const IMAGE_LABEL = /^\[Image #\d+\]$/;

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" ? v : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A tool result's text, whether a string or content blocks. */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((b) => {
      const block = obj(b);
      if (block.type === "text") return str(block.text) ?? "";
      if (block.type === "tool_reference") return `→ ${str(block.tool_name)}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * What the user sees of a user message: Claude Code wraps commands, their
 * output and its own notices in tags. Null = nothing to show.
 */
export function visibleUserText(text: string): string | null {
  const trimmed = text.trim();
  const command = /<command-name>([^<]*)<\/command-name>/.exec(trimmed);
  if (command) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(trimmed);
    return `${command[1]}${args?.[1] ? ` ${args[1]}` : ""}`.trim();
  }
  if (
    trimmed === "" ||
    /^<(local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|task-notification|bash-input|bash-stdout|bash-stderr)\b/.test(
      trimmed,
    ) ||
    trimmed.startsWith("Caveat:") ||
    trimmed.startsWith("[Request interrupted") ||
    // A Stop hook's denial, handed back to Claude as if the user wrote it.
    trimmed.startsWith("Stop hook feedback:")
  ) {
    return null;
  }
  return trimmed;
}

/** A replaced item keeps the time it first showed (a streamed block's start). */
function upsertItem(items: ChatItem[], item: ChatItem): ChatItem[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i < 0) return [...items, item];
  const next = items.slice();
  next[i] = { ...item, at: items[i].at ?? item.at };
  return next;
}

/** When the SDK says a message was written (its `timestamp`), else `fallback`. */
function messageTime(m: JsonObject, fallback?: number): number | undefined {
  const ms = Date.parse(str(m.timestamp) ?? "");
  return Number.isNaN(ms) ? fallback : ms;
}

/** Pasted images kept in memory per chat, at most this many and this much
 *  base64, the newest first: older messages keep their count alone. */
const KEPT_PASTED = 20;
const KEPT_PASTED_CHARS = 30_000_000;

/** Drops the pasted images of older messages past the caps, whole messages. */
function keepPasted(items: ChatItem[]): ChatItem[] {
  let count = 0;
  let chars = 0;
  let next = items;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "user" || !item.pasted?.length) continue;
    const size = item.pasted.reduce((n, url) => n + url.length, 0);
    if (
      count + item.pasted.length <= KEPT_PASTED &&
      chars + size <= KEPT_PASTED_CHARS
    ) {
      count += item.pasted.length;
      chars += size;
      continue;
    }
    if (next === items) next = items.slice();
    next[i] = { ...item, pasted: undefined };
  }
  return next;
}

/** A base64 image block's data URL; undefined for any other source. */
function imageUrl(block: JsonObject): string | undefined {
  const source = obj(block.source);
  const data = str(source.data);
  if (source.type !== "base64" || !data) return undefined;
  return `data:${str(source.media_type) ?? "image/png"};base64,${data}`;
}

function patchItem(
  items: ChatItem[],
  id: string,
  patch: (item: ChatItem) => ChatItem,
): ChatItem[] {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return items;
  const next = items.slice();
  next[i] = patch(items[i]);
  return next;
}

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * Claude Code's stand-in reply, never Claude's words: a message of its own
 * (model `<synthetic>`) that closes a conversation left on an interrupt, or
 * fills a turn stopped by the usage limit (whose notice says why).
 */
export function isStandIn(message: JsonObject, text: string): boolean {
  return message.model === "<synthetic>" && text === "No response requested.";
}

/** An assistant message's blocks, streamed or not, into items. */
function addAssistant(
  state: ChatState,
  m: JsonObject,
  received?: number,
): ChatState {
  const message = obj(m.message);
  const msgId = str(message.id) ?? str(m.uuid) ?? "";
  const at = messageTime(m, received);
  let { items, streams, turnTools, turnFiles } = state;
  arr(message.content).forEach((raw, blockIndex) => {
    const block = obj(raw);
    if (block.type === "tool_use") {
      const id = str(block.id) ?? `${msgId}:${blockIndex}`;
      const name = str(block.name) ?? "?";
      const input = obj(block.input);
      const prev = items.find((x) => x.id === id);
      if (!prev) turnTools += 1;
      const file = str(input.file_path) ?? str(input.notebook_path);
      if (EDIT_TOOLS.has(name) && file && !turnFiles.includes(file))
        turnFiles = [...turnFiles, file];
      items = upsertItem(items, {
        kind: "tool",
        id,
        name,
        input,
        result: prev?.kind === "tool" ? prev.result : undefined,
        at,
      });
      return;
    }
    if (block.type !== "text" && block.type !== "thinking") return;
    const text =
      (block.type === "text" ? str(block.text) : str(block.thinking)) ?? "";
    if (block.type === "text" && isStandIn(message, text)) return;
    // The streamed item of this message still open for this kind of block:
    // Claude Code sends one assistant message per block, in stream order.
    const streamed = Object.entries(streams).find(([key, id]) => {
      if (!key.startsWith(`${msgId}:`)) return false;
      const item = items.find((x) => x.id === id);
      return (
        (item?.kind === "text" || item?.kind === "thinking") &&
        item.kind === block.type &&
        item.streaming
      );
    });
    const id = streamed?.[1] ?? `${str(m.uuid) ?? msgId}:${blockIndex}`;
    if (block.type === "text") {
      items = upsertItem(items, {
        kind: "text",
        id,
        text,
        streaming: false,
        error: typeof m.error === "string" || undefined,
        aborted: m.aborted === true || undefined,
        at,
      });
    } else {
      items = upsertItem(items, {
        kind: "thinking",
        id,
        text,
        streaming: false,
        at,
      });
    }
    if (streamed) {
      streams = { ...streams };
      delete streams[streamed[0]];
    }
  });
  return { ...state, items, streams, turnTools, turnFiles };
}

/**
 * Another session's message: its own frame, never the user's. A subagent's
 * report to this session shows nothing: Claude says what matters of it (the
 * user's ask of 01/11/2026).
 */
function addPeers(
  state: ChatState,
  m: JsonObject,
  peers: PeerMessage[],
): ChatState {
  const id = str(m.uuid) ?? `p${state.items.length}`;
  const at = messageTime(m);
  return {
    ...state,
    items: peers.reduce(
      (items, peer, i) =>
        peer.agentId
          ? items
          : upsertItem(items, {
              kind: "peer",
              id: peers.length > 1 ? `${id}:${i}` : id,
              ...peer,
              at,
            }),
      state.items,
    ),
  };
}

/** A user message: tool results go to their calls, text becomes a bubble. */
function addUser(
  state: ChatState,
  m: JsonObject,
  fromHistory: boolean,
): ChatState {
  const peers = peerMessages(m);
  if (peers) return addPeers(state, m, peers);
  if (fromHistory) {
    const command = addHistoryCommand(state, m);
    if (command) return command;
  }
  const message = obj(m.message);
  let items = state.items;
  const content = message.content;
  // Claude Code's own notes in the user's turn (« [Image: original
  // 2400x1350…] » after an image read, a skill's text): never the user's
  // words, never a frame (seen in a subagent's sheet, 01/11/2026).
  if (m.isMeta === true && typeof content === "string") return state;
  if (typeof content === "string") {
    if (!fromHistory) return state;
    const bash = pastBash(state, m, content);
    if (bash) return bash;
    const text = visibleUserText(content);
    if (text === null) return state;
    return {
      ...state,
      items: [
        ...items,
        {
          kind: "user",
          id: str(m.uuid) ?? `u${items.length}`,
          text,
          images: 0,
          at: messageTime(m),
        },
      ],
    };
  }
  let texts: string[] = [];
  let images = 0;
  let pasted: string[] = [];
  // The structured result is the message's: one tool result per message.
  const results = arr(content).filter((b) => obj(b).type === "tool_result");
  const structured = results.length === 1 ? m.tool_use_result : undefined;
  for (const raw of arr(content)) {
    const block = obj(raw);
    if (block.type === "tool_result") {
      const id = str(block.tool_use_id) ?? "";
      items = patchItem(items, id, (item) =>
        item.kind === "tool"
          ? {
              ...item,
              result: {
                text: resultText(block.content),
                isError: block.is_error === true,
                detail: toolDetail(item.name, structured),
              },
            }
          : item,
      );
    } else if (
      block.type === "text" &&
      fromHistory &&
      !IMAGE_LABEL.test(str(block.text) ?? "")
    ) {
      // A session started from a handoff: its block is the separator.
      const handoff = historyHandoff(
        str(block.text) ?? "",
        str(m.uuid) ?? `${items.length}`,
        messageTime(m),
      );
      if (handoff) {
        items = [...items, handoff];
        continue;
      }
      const text = visibleUserText(str(block.text) ?? "");
      if (text !== null) texts = [...texts, text];
    } else if (block.type === "image" && fromHistory) {
      images += 1;
      const url = imageUrl(block);
      if (url) pasted = [...pasted, url];
    }
  }
  if (texts.length > 0 || images > 0) {
    items = [
      ...items,
      {
        kind: "user",
        id: str(m.uuid) ?? `u${items.length}`,
        text: texts.join("\n"),
        images,
        pasted: pasted.length > 0 ? pasted : undefined,
        at: messageTime(m),
      },
    ];
  }
  return { ...state, items };
}

/** Claude Code's escapes in a `!` command's output (`escapeOutput` of the server). */
const unescapeOutput = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** What the server adds to the errors of a `!` command stopped by Esc. */
const BASH_STOPPED = "[Command stopped by the user]";

/**
 * A `!` command read from the past: its `<bash-input>` entry becomes its
 * card, the `<bash-stdout>` one right after fills it. Null: not one of them.
 */
function pastBash(
  state: ChatState,
  m: JsonObject,
  content: string,
): ChatState | null {
  const input = /^<bash-input>([\s\S]*)<\/bash-input>$/.exec(content.trim());
  if (input) {
    const item: ChatItem = {
      kind: "bash",
      id: str(m.uuid) ?? `b${state.items.length}`,
      command: input[1].trim(),
      stdout: "",
      stderr: "",
      running: false,
      at: messageTime(m),
    };
    return { ...state, items: [...state.items, item] };
  }
  const output =
    /^<bash-stdout>([\s\S]*)<\/bash-stdout><bash-stderr>([\s\S]*)<\/bash-stderr>$/.exec(
      content.trim(),
    );
  if (!output) return null;
  const last = state.items[state.items.length - 1];
  // Its command's card only: an output alone shows nothing.
  if (last?.kind !== "bash" || last.stdout || last.stderr) return state;
  const stdout = unescapeOutput(output[1]);
  let stderr = unescapeOutput(output[2]);
  const stopped = stderr.endsWith(BASH_STOPPED);
  if (stopped) stderr = stderr.slice(0, -BASH_STOPPED.length).trimEnd();
  const filled: ChatItem = {
    ...last,
    stdout: stdout === "(Bash completed with no output)" ? "" : stdout,
    stderr,
    stopped: stopped || undefined,
  };
  return { ...state, items: [...state.items.slice(0, -1), filled] };
}

/** A live `!` command's output is kept to its last this many characters per stream. */
const BASH_KEPT = 60_000;

/** A `!` command: its card when it starts, its output as it comes, its end. */
function addBash(
  state: ChatState,
  event: Extract<ChatEvent, { type: "bash" | "bash_output" }>,
  now: number,
): ChatState {
  const id = `bash:${event.id}`;
  if (event.type === "bash_output") {
    return {
      ...state,
      items: patchItem(state.items, id, (item) =>
        item.kind === "bash" && item.running
          ? {
              ...item,
              [event.stream]: (item[event.stream] + event.text).slice(
                -BASH_KEPT,
              ),
            }
          : item,
      ),
    };
  }
  const item: ChatItem = {
    kind: "bash",
    id,
    command: event.command,
    stdout: event.stdout ?? "",
    stderr: event.stderr ?? "",
    running: event.state === "running",
    code: event.code,
    stopped: event.stopped,
    error: event.error,
    sent: event.sent,
    total: event.total,
    at: now,
  };
  // Typed with an empty input: something else was written, the suggestion goes.
  return { ...state, suggestion: null, items: upsertItem(state.items, item) };
}

/** A `!` command still runs: what the user sends waits for it (`chat-server`). */
function runningBashIn(items: ChatItem[]): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "bash" && item.running) return true;
  }
  return false;
}

/** What still ran when its Claude Code went: a `!` command is stopped with it. */
function endBashes(items: ChatItem[]): ChatItem[] {
  if (!items.some((x) => x.kind === "bash" && x.running)) return items;
  return items.map((x) =>
    x.kind === "bash" && x.running
      ? { ...x, running: false, stopped: true, code: null }
      : x,
  );
}

/**
 * Its Claude Code went mid-turn and the chat goes on (the server restarted,
 * `chatLive`): the turn, its tasks and its requests end where they were,
 * what waited was not sent; the chat stays open.
 */
export function cutTurn(state: ChatState, now: number): ChatState {
  const ended = endTurn(interruptTasks(state, now));
  return {
    ...ended,
    items: endBashes(dropQueued(ended.items)),
    requests: [],
    sdk: closeSdk(ended.sdk),
  };
}

function addStreamEvent(
  state: ChatState,
  m: JsonObject,
  at: number,
): ChatState {
  const event = obj(m.event);
  const msgId = str(m.api_message_id) ?? "";
  const key = `${msgId}:${num(event.index) ?? 0}`;
  switch (event.type) {
    case "content_block_start": {
      const block = obj(event.content_block);
      if (block.type === "tool_use") {
        const id = str(block.id) ?? key;
        const known = state.items.some((x) => x.id === id);
        return {
          ...state,
          livePhase: "tool-input",
          turnTools: known ? state.turnTools : state.turnTools + 1,
          items: upsertItem(state.items, {
            kind: "tool",
            id,
            name: str(block.name) ?? "?",
            input: {},
            at,
          }),
        };
      }
      if (block.type !== "text" && block.type !== "thinking") return state;
      const id = str(m.uuid) ?? key;
      return {
        ...state,
        livePhase: block.type === "text" ? "responding" : "thinking",
        streams: { ...state.streams, [key]: id },
        items: [
          ...state.items,
          block.type === "text"
            ? { kind: "text", id, text: "", streaming: true, at }
            : { kind: "thinking", id, text: "", streaming: true, at },
        ],
      };
    }
    case "content_block_delta": {
      const id = state.streams[key];
      if (!id) return state;
      const delta = obj(event.delta);
      const piece =
        delta.type === "text_delta"
          ? str(delta.text)
          : delta.type === "thinking_delta"
            ? str(delta.thinking)
            : undefined;
      if (!piece) return state;
      return {
        ...state,
        items: patchItem(state.items, id, (item) =>
          item.kind === "text" || item.kind === "thinking"
            ? { ...item, text: item.text + piece }
            : item,
        ),
      };
    }
    case "message_delta": {
      const out = num(obj(event.usage).output_tokens);
      if (out === undefined) return state;
      const before = state.messageTokens[msgId] ?? 0;
      return {
        ...state,
        turnTokens: state.turnTokens + Math.max(0, out - before),
        messageTokens: { ...state.messageTokens, [msgId]: out },
        // The real count has the thinking estimated so far.
        thinkingTokens: 0,
      };
    }
    default:
      return state;
  }
}

function addSystem(state: ChatState, m: JsonObject, now: number): ChatState {
  switch (m.subtype) {
    case "init":
      return {
        ...state,
        sessionId: str(m.session_id) ?? state.sessionId,
        model: str(m.model) ?? state.model,
        mode: str(m.permissionMode) ?? state.mode,
        slashCommands: arr(m.slash_commands).filter(
          (c): c is string => typeof c === "string",
        ),
      };
    case "status": {
      const status =
        m.status === "requesting" || m.status === "compacting"
          ? m.status
          : null;
      return {
        ...state,
        status,
        mode: str(m.permissionMode) ?? state.mode,
        livePhase: status === "requesting" ? "requesting" : state.livePhase,
      };
    }
    case "session_title_changed":
      return { ...state, title: str(m.title) ?? state.title };
    case "commands_changed":
      return { ...state, commands: commandList(m.commands) };
    case "compact_boundary":
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: "notice",
            id: str(m.uuid) ?? `c${state.items.length}`,
            text: compactNotice(m),
            tone: "info",
          },
        ],
      };
    // Subagents, shells and workflows each to their own list (`task_type`).
    case "task_started":
    case "task_progress":
    case "task_updated":
    case "task_notification":
    case "background_tasks_changed":
      return addTaskEvent(state, m, now);
    // Ticks while Claude thinks: no text streams then (`thinkingTokens`).
    case "thinking_tokens":
      return {
        ...state,
        thinkingTokens:
          state.thinkingTokens + (num(m.estimated_tokens_delta) ?? 0),
      };
    default:
      return state;
  }
}

/** Rate limits: the five-hour and weekly windows, as the status line shows. */
function addRateLimit(state: ChatState, m: JsonObject): ChatState {
  const info = obj(m.rate_limit_info);
  const windows = obj(info.unifiedWindows);
  const read = (w: JsonObject): RateWindow | undefined => {
    const utilization = num(w.utilization);
    return utilization === undefined
      ? undefined
      : { utilization, resetsAt: num(w.resetsAt) };
  };
  const limits = { ...state.limits };
  const fiveHour = read(obj(windows.five_hour));
  const sevenDay = read(obj(windows.seven_day));
  if (fiveHour) limits.fiveHour = fiveHour;
  if (sevenDay) limits.sevenDay = sevenDay;
  const direct = read(info);
  if (direct && info.rateLimitType === "five_hour") limits.fiveHour = direct;
  if (direct && info.rateLimitType === "seven_day") limits.sevenDay = direct;
  return { ...state, limits };
}

/** A `/usage` reset in epoch seconds: Claude Code sends ISO text or seconds. */
function epochSeconds(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  const ms = Date.parse(str(v) ?? "");
  return Number.isNaN(ms) ? undefined : Math.round(ms / 1000);
}

/**
 * The plan's windows from `/usage` (percent 0-100), read as the terminal's
 * status line reads them: `five_hour` and `seven_day`, else the server's
 * `session` and `weekly_all` rows. A window it lacks stays as the last rate
 * limit event left it.
 */
function addUsage(state: ChatState, rateLimits: JsonObject | null): ChatState {
  if (!rateLimits) return state;
  const rows = arr(rateLimits.limits).map(obj);
  const read = (bucket: unknown, kind: string): RateWindow | undefined => {
    const b = obj(bucket);
    // A row at 0 % with no reset is a placeholder (ccstatusline skips it).
    const row = rows.find(
      (r) =>
        r.kind === kind &&
        (!!num(r.percent) || epochSeconds(r.resets_at) !== undefined),
    );
    const percent = num(b.utilization) ?? num(row?.percent);
    if (percent === undefined) return undefined;
    return {
      utilization: percent / 100,
      resetsAt: epochSeconds(b.resets_at) ?? epochSeconds(row?.resets_at),
    };
  };
  return {
    ...state,
    limits: {
      fiveHour: read(rateLimits.five_hour, "session") ?? state.limits.fiveHour,
      sevenDay:
        read(rateLimits.seven_day, "weekly_all") ?? state.limits.sevenDay,
    },
  };
}

/**
 * A window as it stands at `now`: past its reset, the next one starts with
 * the next request, so nothing of it is used and its reset isn't known yet.
 */
export function liveWindow(
  win: RateWindow | undefined,
  now: number,
): RateWindow | undefined {
  if (win?.resetsAt === undefined || win.resetsAt * 1000 > now) return win;
  return { utilization: 0 };
}

/**
 * Context used, 0-100, of the whole window, as its detail counts it (the
 * user's pick of 01/11/2026: « 57 % », not the terminal's « Ctx(u) » 71 %
 * of the part usable before auto-compact).
 */
function contextPercent(
  event: Extract<ChatEvent, { type: "context" }>,
): number {
  if (event.maxTokens <= 0) return event.percentage;
  return Math.min(100, (event.totalTokens / event.maxTokens) * 100);
}

/**
 * Messages Claude Code took from its queue: a `command_lifecycle` frame past
 * « queued » names one, a turn's frames list those it consumed so far
 * (`user_message_uuids`, the fallback for a CLI without lifecycle frames).
 * One it « cancelled » was never taken: it shows as not sent.
 */
function takeQueued(state: ChatState, m: JsonObject, now: number): ChatState {
  const cancelled = m.type === "command_lifecycle" && m.state === "cancelled";
  const taken =
    m.type === "command_lifecycle"
      ? m.state === "queued"
        ? []
        : [m.command_uuid]
      : arr(m.user_message_uuids);
  let items = state.items;
  for (const uuid of taken) {
    if (typeof uuid !== "string") continue;
    // Queued messages are the latest: look from the end.
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.id !== `sent:${uuid}`) continue;
      // A slash command waits like any message (`addCommandSent`).
      if ((item.kind === "user" || item.kind === "command") && item.queued) {
        items = items.slice();
        items[i] = cancelled
          ? { ...item, queued: false, dropped: true }
          : { ...item, queued: false };
        // Held behind a `!` command (no turn ran): taken, its turn opens now,
        // not at Claude's first word.
        if (!cancelled) state = startTurn(state, now);
      }
      break;
    }
  }
  return items === state.items ? state : { ...state, items };
}

/** The chat ended (closed, its server gone): what still waited was not sent. */
function dropQueued(items: ChatItem[]): ChatItem[] {
  if (!hasQueued(items)) return items;
  return items.map((item) =>
    (item.kind === "user" || item.kind === "command") && item.queued
      ? { ...item, queued: false, dropped: true }
      : item,
  );
}

/** A message still waits for Claude (one sent « now » may pass those before it). */
export function hasQueued(items: ChatItem[]): boolean {
  return items.some(
    (item) => (item.kind === "user" || item.kind === "command") && item.queued,
  );
}

/** Closes the turn: nothing streams any more. */
function endTurn(state: ChatState): ChatState {
  return {
    ...state,
    working: false,
    turnStartedAt: null,
    status: null,
    streams: {},
    messageTokens: {},
    liveTools: [],
    livePhase: null,
    turnTools: 0,
    turnFiles: [],
    retry: null,
    thinkingTokens: 0,
    interrupted: false,
    items: state.items.map((item) =>
      (item.kind === "text" || item.kind === "thinking") && item.streaming
        ? { ...item, streaming: false }
        : item,
    ),
  };
}

/**
 * Tool calls run from their assistant message to their result, the main
 * loop's and its subagents' alike: the live line shows the latest.
 */
function trackLive(state: ChatState, m: JsonObject, now: number): ChatState {
  const blocks = arr(obj(m.message).content).map(obj);
  if (m.type === "assistant") {
    const started: LiveTool[] = blocks.flatMap((b) => {
      const id = str(b.id);
      if (b.type !== "tool_use" || !id) return [];
      if (state.liveTools.some((t) => t.id === id)) return [];
      return [
        {
          id,
          name: str(b.name) ?? "?",
          input: obj(b.input),
          agent: Boolean(m.parent_tool_use_id),
          startedAt: now,
        },
      ];
    });
    if (started.length === 0) return state;
    return { ...state, liveTools: [...state.liveTools, ...started] };
  }
  if (m.type !== "user") return state;
  const done = new Set(
    blocks
      .filter((b) => b.type === "tool_result")
      .map((b) => str(b.tool_use_id)),
  );
  if (!state.liveTools.some((t) => done.has(t.id))) return state;
  return {
    ...state,
    liveTools: state.liveTools.filter((t) => !done.has(t.id)),
  };
}

/** An interrupt mid-reply: what was still streaming is cut. */
function markCut(state: ChatState, m: JsonObject): ChatState {
  if (m.terminal_reason !== "aborted_streaming") return state;
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind === "text" && item.streaming
        ? { ...item, aborted: true }
        : item,
    ),
  };
}

/**
 * Claude Code's note that the user stopped the turn. An Esc while a Stop
 * hook runs ends it as `stop_hook_prevented`, a success: only this note
 * tells the user's interrupt from the hook's (verified live 31/10/2026).
 */
export function isInterruptNote(m: JsonObject): boolean {
  const content = obj(m.message).content;
  const texts =
    typeof content === "string"
      ? [content]
      : arr(content).map((b) => str(obj(b).text) ?? "");
  return texts.some((t) => t.startsWith("[Request interrupted by user"));
}

function markInterrupt(state: ChatState, m: JsonObject): ChatState {
  return isInterruptNote(m) ? { ...state, interrupted: true } : state;
}

function addSdk(state: ChatState, m: JsonObject, now: number): ChatState {
  state = trackLive(state, m, now);
  // A tool's running time, a subagent's retries (`chatTasks`).
  if (m.type === "tool_progress") state = addToolProgress(state, m, now);
  // Retries, suggestions, Claude Code's notices (`chatSdkContent`).
  state = addSdkContent(state, m, now);
  // A subagent's own messages belong to its card and sheet, not to the column.
  if (m.parent_tool_use_id) return addSubagentMessage(state, m);
  // Fast mode, MCP servers, hooks, plugin errors (`chatSdkSettings`).
  state = addSdkSettings(state, m, now);
  switch (m.type) {
    case "system":
      return addSystem(state, m, now);
    // Claude's first reply opens a turn it started itself (a task's report,
    // a wakeup, another session's message, a message held behind a `!`).
    case "stream_event":
      return addStreamEvent(startTurn(state, now), m, now);
    case "assistant":
      return commandAnswer(state, m) ?? addAssistant(state, m, now);
    case "user":
      return addUser(markInterrupt(state, m), m, false);
    case "rate_limit_event":
      return addRateLimit(state, m);
    case "conversation_reset":
      return resetConversation(state, m);
    case "result": {
      // A local command's turn (no model): its answer goes in its card.
      state = endCommandTurn(state, m);
      // Kept for every turn; `turnDoneLine` decides whether it shows.
      const turn: ChatItem = {
        kind: "turn",
        id: `turn:${str(m.uuid) ?? state.items.length}`,
        durationMs:
          num(m.duration_ms) ??
          (state.turnStartedAt === null ? 0 : now - state.turnStartedAt),
        tools: state.turnTools,
        files: state.turnFiles.length,
        at: now,
      };
      // Why it stopped, in words: only a real interrupt is « Tour interrompu ».
      const notice = resultNotice(m, {
        apiError: state.apiError,
        now,
        interrupted: state.interrupted,
      });
      const ended = { ...endTurn(markCut(state, m)), apiError: null };
      if (!notice) return { ...ended, items: [...ended.items, turn] };
      return {
        ...ended,
        items: [
          ...ended.items,
          {
            kind: "notice",
            id: str(m.uuid) ?? `r${ended.items.length}`,
            ...notice,
            at: now,
          },
          turn,
        ],
      };
    }
    default:
      return state;
  }
}

/** The tool calls a past user message holds results for. */
function resultIds(m: JsonObject): string[] {
  if (m.type !== "user" || m.parent_tool_use_id) return [];
  return arr(obj(m.message).content).flatMap((raw) => {
    const block = obj(raw);
    const id = str(block.tool_use_id);
    return block.type === "tool_result" && id ? [id] : [];
  });
}

/**
 * Past messages of a resumed session, before what this chat adds; `older`,
 * a page from before the oldest already there: on top of everything, what
 * the column already holds kept as it is.
 */
function addHistory(
  state: ChatState,
  messages: JsonObject[],
  truncated: boolean,
  older = false,
): ChatState {
  let past: ChatState = { ...EMPTY_CHAT };
  for (const m of messages) {
    if (m.parent_tool_use_id) continue;
    if (m.type === "assistant") past = addAssistant(past, m);
    else if (m.type === "user") past = addUser(past, m, true);
  }
  // Results of the page shown whose calls this older page brings.
  const kept = older ? state.historyOrphans : [];
  for (const m of kept) past = addUser(past, m, false);
  const calls = new Set(
    past.items.filter((x) => x.kind === "tool").map((x) => x.id),
  );
  const orphans = [...kept, ...messages].filter((m) =>
    resultIds(m).some((id) => !calls.has(id)),
  );
  // Nothing of the past runs: a call left without a result never gets one.
  past = {
    ...past,
    items: past.items.map((x) =>
      x.kind === "tool" && !x.result ? { ...x, stale: true } : x,
    ),
  };
  const cursor = str(messages[0]?.uuid) ?? state.historyCursor;
  // Its subagents, « interrompu » if their end never came; live ones win.
  const live = new Set(state.subagents.map((s) => s.toolUseId));
  const pastAgents = historySubagents(messages, past.items).filter(
    (s) => !live.has(s.toolUseId),
  );
  if (pastAgents.length > 0)
    state = { ...state, subagents: [...pastAgents, ...state.subagents] };
  if (older) {
    const shown = new Set(state.items.map((x) => x.id));
    return {
      ...state,
      items: keepPasted([
        ...past.items.filter((x) => !shown.has(x.id)),
        ...state.items,
      ]),
      historyTruncated: truncated,
      historyCursor: cursor,
      historyOrphans: orphans,
    };
  }
  const known = new Set(past.items.map((x) => x.id));
  return {
    ...state,
    items: keepPasted([
      ...past.items,
      ...state.items.filter((x) => !known.has(x.id)),
    ]),
    historyLoaded: true,
    historyTruncated: truncated,
    historyCursor: cursor,
    historyOrphans: orphans,
  };
}

/**
 * `received` is when the page got the event; the chat server stamps what it
 * logs (`at`), so a replay after a reload keeps the times things happened.
 */
export function reduceChat(
  state: ChatState,
  event: ChatEvent,
  received: number,
): ChatState {
  const now =
    "at" in event && typeof event.at === "number" ? event.at : received;
  switch (event.type) {
    case "attached":
      return EMPTY_CHAT;
    case "user_sent": {
      // Something else was written: the suggestion goes.
      if (state.suggestion) state = { ...state, suggestion: null };
      // Sent to a chat asleep: the server wakes it first (`awake`).
      if (state.asleep) state = { ...state, asleep: false };
      // Held by the server behind a `!` command still running: it waits
      // (its × withdraws it), and the turn starts with Claude's first reply.
      const held = !state.working && !!event.uuid && runningBashIn(state.items);
      if (isCommandSent(state, event))
        return addCommandSent(state, event, now, held);
      if (held) {
        return {
          ...state,
          closed: null,
          items: keepPasted([
            ...state.items,
            {
              kind: "user",
              id: `sent:${event.uuid}`,
              text: event.text,
              images: event.images,
              queued: true,
              pasted: event.pasted?.length
                ? event.pasted.map(
                    (img) => `data:${img.mediaType};base64,${img.data}`,
                  )
                : undefined,
              ...(event.pastes?.length ? { pastes: event.pastes } : {}),
              at: now,
            },
          ]),
        };
      }
      return {
        // A message queued behind the turn under way doesn't restart its clock.
        ...startTurn(state, now),
        closed: null,
        items: keepPasted([
          ...state.items,
          {
            kind: "user",
            id: event.uuid
              ? `sent:${event.uuid}`
              : `sent:${now}:${state.items.length}`,
            text: event.text,
            images: event.images,
            // Claude Code queues it until the turn makes room (`takeQueued`).
            ...(state.working && event.uuid ? { queued: true } : {}),
            pasted: event.pasted?.length
              ? event.pasted.map(
                  (img) => `data:${img.mediaType};base64,${img.data}`,
                )
              : undefined,
            ...(event.pastes?.length ? { pastes: event.pastes } : {}),
            at: now,
          },
        ]),
      };
    }
    case "sdk":
      return addSdk(
        markCommandStarted(
          takeQueued(state, event.message, now),
          event.message,
          now,
        ),
        event.message,
        now,
      );
    case "permission":
      return {
        ...state,
        requests: [
          ...state.requests.filter((r) => r.requestId !== event.requestId),
          {
            requestId: event.requestId,
            toolName: event.toolName,
            input: event.input,
            toolUseId: event.toolUseId,
            title: event.title,
            description: event.description,
            suggestions: event.suggestions,
            displayName: event.displayName,
            defaultToNo: event.defaultToNo,
            suppressAlwaysAllowRule: event.suppressAlwaysAllowRule,
            agentId: event.agentId,
            blockedPath: event.blockedPath,
            mcpServer: event.mcpServer,
          },
        ],
      };
    case "permission_resolved":
      return {
        ...state,
        requests: state.requests.filter((r) => r.requestId !== event.requestId),
      };
    case "context":
      return {
        ...state,
        context: { percentage: contextPercent(event) },
        model: event.model ?? state.model,
      };
    case "usage":
      return addUsage(state, event.rateLimits);
    case "commands":
      return { ...state, commands: commandList(event.commands) };
    case "notice":
      return addServerNotice(state, event, now);
    case "handoff":
      return addHandoff(state, event, now);
    case "info":
      return {
        ...state,
        sessionId: event.sessionId ?? state.sessionId,
        title: event.title ?? state.title,
        gitBranch:
          event.gitBranch === undefined ? state.gitBranch : event.gitBranch,
        // Only until the first turn's init says it: later, init and status rule.
        mode: state.mode ?? event.mode ?? null,
        rewind: event.rewind === undefined ? state.rewind : event.rewind,
      };
    case "history":
      if (event.agentId) return state;
      // Compacted since the page was shown: no older page, and why.
      if (event.unreachable) {
        return {
          ...state,
          historyTruncated: false,
          items: [
            {
              kind: "notice",
              id: "older-unreachable",
              text: "Les messages d'avant la compaction ne se rechargent pas ici",
              tone: "info",
            },
            ...state.items.filter((x) => x.id !== "older-unreachable"),
          ],
        };
      }
      return addHistory(state, event.messages, event.truncated, event.older);
    case "workflow_live":
      return addWorkflowLive(state, event.taskId, event.agents);
    case "visual_check": {
      if (!event.toolUseId) return state;
      const known = state.visuals[event.toolUseId];
      return {
        ...state,
        visuals: {
          ...state.visuals,
          // A replayed check has no page: one already known stays.
          [event.toolUseId]: {
            html: event.html ?? known?.html ?? null,
            checking: true,
            stored: event.stored === true,
          },
        },
      };
    }
    case "visual_checked": {
      const entry = state.visuals[event.checkId];
      if (!entry) return state;
      return {
        ...state,
        visuals: {
          ...state.visuals,
          [event.checkId]: { ...entry, checking: false },
        },
      };
    }
    case "visual_html": {
      const known = state.visuals[event.toolUseId];
      // A page already known (sent live) wins over the kept copy.
      if (known?.html) return state;
      return {
        ...state,
        visuals: {
          ...state.visuals,
          [event.toolUseId]: {
            html: event.html,
            checking: known?.checking ?? false,
          },
        },
      };
    }
    case "closed":
      // Its Claude Code is gone, and the background work it ran with it.
      return {
        ...cutTurn(state, now),
        asleep: false,
        closed: { error: event.error },
      };
    case "asleep":
      return { ...state, asleep: true };
    case "awake":
      return { ...state, asleep: false };
    case "bash":
    case "bash_output":
      return addBash(state, event, now);
    case "models":
    case "effort":
    case "mcp":
    case "elicitation":
    case "elicitation_resolved":
    case "queued_removed":
      return reduceSdkEvent(state, event);
    case "error":
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: "notice",
            id: `e${now}:${state.items.length}`,
            text: event.message,
            tone: "error",
          },
        ],
      };
    default:
      return state;
  }
}

export interface TaskItem {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
}

/**
 * Claude's task list, as its tool calls left it: TodoWrite replaces the whole
 * list, TaskCreate adds one (its number is in the result), TaskUpdate edits.
 */
export function tasksOf(items: ChatItem[]): TaskItem[] {
  let tasks: TaskItem[] = [];
  for (const item of items) {
    if (item.kind !== "tool") continue;
    const input = item.input;
    if (item.name === "TodoWrite") {
      tasks = arr(input.todos).map((t, i) => {
        const todo = obj(t);
        return {
          id: String(i + 1),
          subject: str(todo.content) ?? "",
          status: taskStatus(todo.status),
        };
      });
    } else if (item.name === "TaskCreate") {
      const id = /#(\d+)/.exec(item.result?.text ?? "")?.[1] ?? item.id;
      tasks = [
        ...tasks,
        { id, subject: str(input.subject) ?? "", status: "pending" },
      ];
    } else if (item.name === "TaskUpdate") {
      const id = str(input.taskId);
      if (input.status === "deleted") {
        tasks = tasks.filter((t) => t.id !== id);
        continue;
      }
      tasks = tasks.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              subject: str(input.subject) ?? t.subject,
              status: input.status ? taskStatus(input.status) : t.status,
            },
      );
    }
  }
  return tasks;
}

function taskStatus(v: unknown): TaskItem["status"] {
  return v === "in_progress" || v === "completed" ? v : "pending";
}

/**
 * The plan a pending ExitPlanMode asks to approve: Claude Code writes it to
 * a file of its `plans` folder just before, and the request carries nothing.
 */
export function latestPlan(items: ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "tool") continue;
    const plan = str(item.input.plan);
    if (item.name === "ExitPlanMode" && plan) return plan;
    const path = str(item.input.file_path) ?? "";
    const content = str(item.input.content);
    if (
      item.name === "Write" &&
      content &&
      /[\\/]plans[\\/][^\\/]+\.md$/i.test(path)
    ) {
      return content;
    }
  }
  return null;
}
