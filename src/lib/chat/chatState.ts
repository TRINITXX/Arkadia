import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";

/**
 * The chat view's state, built from the chat server's events alone (the same
 * events replayed after a page reload rebuild the same state). Pure: `now`
 * comes in with each event.
 */

export type ChatItem =
  | { kind: "user"; id: string; text: string; images: number }
  | { kind: "text"; id: string; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      /** The tool_use id: results and permission requests point at it. */
      id: string;
      name: string;
      input: JsonObject;
      result?: { text: string; isError: boolean };
    }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

export interface Subagent {
  taskId: string;
  /** The Agent tool call that started it. */
  toolUseId?: string;
  description: string;
  type?: string;
  status: "running" | "completed" | "failed" | "stopped";
  toolUses: number;
  tokens: number;
  durationMs: number;
  lastTool?: string;
  summary?: string;
}

export interface PendingRequest {
  requestId: string;
  toolName: string;
  input: JsonObject;
  toolUseId: string;
  title?: string;
  description?: string;
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
  working: boolean;
  turnStartedAt: number | null;
  /** Output tokens of the current turn, thinking included. */
  turnTokens: number;
  status: "requesting" | "compacting" | null;
  requests: PendingRequest[];
  subagents: Subagent[];
  /** 0-100 of the window usable before auto-compact. */
  context: { percentage: number } | null;
  limits: { fiveHour?: RateWindow; sevenDay?: RateWindow };
  historyLoaded: boolean;
  historyTruncated: boolean;
  closed: { error?: string } | null;
  /** Streamed block (`<message id>:<index>`) → its item id. */
  streams: Record<string, string>;
  /** Output tokens already counted per API message of the turn. */
  messageTokens: Record<string, number>;
}

export const EMPTY_CHAT: ChatState = {
  items: [],
  sessionId: null,
  title: null,
  gitBranch: null,
  model: null,
  mode: null,
  slashCommands: [],
  working: false,
  turnStartedAt: null,
  turnTokens: 0,
  status: null,
  requests: [],
  subagents: [],
  context: null,
  limits: {},
  historyLoaded: false,
  historyTruncated: false,
  closed: null,
  streams: {},
  messageTokens: {},
};

const obj = (v: unknown): JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
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
    trimmed.startsWith("[Request interrupted")
  ) {
    return null;
  }
  return trimmed;
}

function upsertItem(items: ChatItem[], item: ChatItem): ChatItem[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i < 0) return [...items, item];
  const next = items.slice();
  next[i] = item;
  return next;
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

/** An assistant message's blocks, streamed or not, into items. */
function addAssistant(state: ChatState, m: JsonObject): ChatState {
  const message = obj(m.message);
  const msgId = str(message.id) ?? str(m.uuid) ?? "";
  let { items, streams } = state;
  arr(message.content).forEach((raw, blockIndex) => {
    const block = obj(raw);
    if (block.type === "tool_use") {
      const id = str(block.id) ?? `${msgId}:${blockIndex}`;
      const prev = items.find((x) => x.id === id);
      items = upsertItem(items, {
        kind: "tool",
        id,
        name: str(block.name) ?? "?",
        input: obj(block.input),
        result: prev?.kind === "tool" ? prev.result : undefined,
      });
      return;
    }
    if (block.type !== "text" && block.type !== "thinking") return;
    const text =
      (block.type === "text" ? str(block.text) : str(block.thinking)) ?? "";
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
      items = upsertItem(items, { kind: "text", id, text, streaming: false });
    } else {
      items = upsertItem(items, {
        kind: "thinking",
        id,
        text,
        streaming: false,
      });
    }
    if (streamed) {
      streams = { ...streams };
      delete streams[streamed[0]];
    }
  });
  return { ...state, items, streams };
}

/** A user message: tool results go to their calls, text becomes a bubble. */
function addUser(
  state: ChatState,
  m: JsonObject,
  fromHistory: boolean,
): ChatState {
  const message = obj(m.message);
  let items = state.items;
  const content = message.content;
  if (typeof content === "string") {
    if (!fromHistory) return state;
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
        },
      ],
    };
  }
  let texts: string[] = [];
  let images = 0;
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
              },
            }
          : item,
      );
    } else if (block.type === "text" && fromHistory) {
      const text = visibleUserText(str(block.text) ?? "");
      if (text !== null) texts = [...texts, text];
    } else if (block.type === "image" && fromHistory) {
      images += 1;
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
      },
    ];
  }
  return { ...state, items };
}

function addStreamEvent(state: ChatState, m: JsonObject): ChatState {
  const event = obj(m.event);
  const msgId = str(m.api_message_id) ?? "";
  const key = `${msgId}:${num(event.index) ?? 0}`;
  switch (event.type) {
    case "content_block_start": {
      const block = obj(event.content_block);
      if (block.type === "tool_use") {
        const id = str(block.id) ?? key;
        return {
          ...state,
          items: upsertItem(state.items, {
            kind: "tool",
            id,
            name: str(block.name) ?? "?",
            input: {},
          }),
        };
      }
      if (block.type !== "text" && block.type !== "thinking") return state;
      const id = str(m.uuid) ?? key;
      return {
        ...state,
        streams: { ...state.streams, [key]: id },
        items: [
          ...state.items,
          block.type === "text"
            ? { kind: "text", id, text: "", streaming: true }
            : { kind: "thinking", id, text: "", streaming: true },
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
      };
    }
    default:
      return state;
  }
}

function addSystem(state: ChatState, m: JsonObject): ChatState {
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
      return { ...state, status, mode: str(m.permissionMode) ?? state.mode };
    }
    case "compact_boundary":
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: "notice",
            id: str(m.uuid) ?? `c${state.items.length}`,
            text: "Conversation compactée",
            tone: "info",
          },
        ],
      };
    case "task_started":
      return {
        ...state,
        subagents: [
          ...state.subagents.filter((s) => s.taskId !== m.task_id),
          {
            taskId: str(m.task_id) ?? "",
            toolUseId: str(m.tool_use_id),
            description: str(m.description) ?? "",
            type: str(m.subagent_type),
            status: "running",
            toolUses: 0,
            tokens: 0,
            durationMs: 0,
          },
        ],
      };
    case "task_progress":
    case "task_notification": {
      const usage = obj(m.usage);
      const status = m.status;
      return {
        ...state,
        subagents: state.subagents.map((s) =>
          s.taskId !== m.task_id
            ? s
            : {
                ...s,
                status:
                  status === "completed" ||
                  status === "failed" ||
                  status === "stopped"
                    ? status
                    : s.status,
                toolUses: num(usage.tool_uses) ?? s.toolUses,
                tokens: num(usage.total_tokens) ?? s.tokens,
                durationMs: num(usage.duration_ms) ?? s.durationMs,
                lastTool: str(m.last_tool_name) ?? s.lastTool,
                summary: str(m.summary) ?? s.summary,
              },
        ),
      };
    }
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

/** The share of the window usable before auto-compact, as ccstatusline counts it. */
const USABLE_CONTEXT = 0.8;

/** Context used, 0-100, of the usable window: the terminal's "Ctx(u)". */
function usableContextPercent(
  event: Extract<ChatEvent, { type: "context" }>,
): number {
  const usable = Math.floor(event.maxTokens * USABLE_CONTEXT);
  if (usable <= 0) return event.percentage;
  return Math.min(100, (event.totalTokens / usable) * 100);
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
    items: state.items.map((item) =>
      (item.kind === "text" || item.kind === "thinking") && item.streaming
        ? { ...item, streaming: false }
        : item,
    ),
  };
}

function addSdk(state: ChatState, m: JsonObject, now: number): ChatState {
  // A subagent's own messages belong to its drawer, not to the column.
  if (m.parent_tool_use_id) return state;
  switch (m.type) {
    case "system":
      return addSystem(state, m);
    case "stream_event":
      return addStreamEvent(
        state.working ? state : { ...state, working: true, turnStartedAt: now },
        m,
      );
    case "assistant":
      return addAssistant(state, m);
    case "user":
      return addUser(state, m, false);
    case "rate_limit_event":
      return addRateLimit(state, m);
    case "result": {
      const ended = endTurn(state);
      if (m.is_error !== true && m.subtype === "success") return ended;
      const text =
        m.subtype === "error_during_execution"
          ? "Tour interrompu"
          : `Erreur : ${str(m.result) ?? str(m.subtype) ?? "?"}`;
      return {
        ...ended,
        items: [
          ...ended.items,
          {
            kind: "notice",
            id: str(m.uuid) ?? `r${ended.items.length}`,
            text,
            tone: m.subtype === "error_during_execution" ? "info" : "error",
          },
        ],
      };
    }
    default:
      return state;
  }
}

/** Past messages of a resumed session, before what this chat adds. */
function addHistory(
  state: ChatState,
  messages: JsonObject[],
  truncated: boolean,
): ChatState {
  let past: ChatState = { ...EMPTY_CHAT };
  for (const m of messages) {
    if (m.parent_tool_use_id) continue;
    if (m.type === "assistant") past = addAssistant(past, m);
    else if (m.type === "user") past = addUser(past, m, true);
  }
  const known = new Set(past.items.map((x) => x.id));
  return {
    ...state,
    items: [...past.items, ...state.items.filter((x) => !known.has(x.id))],
    historyLoaded: true,
    historyTruncated: truncated,
  };
}

export function reduceChat(
  state: ChatState,
  event: ChatEvent,
  now: number,
): ChatState {
  switch (event.type) {
    case "attached":
      return EMPTY_CHAT;
    case "user_sent":
      return {
        ...state,
        working: true,
        turnStartedAt: now,
        turnTokens: 0,
        closed: null,
        items: [
          ...state.items,
          {
            kind: "user",
            id: `sent:${now}:${state.items.length}`,
            text: event.text,
            images: event.images,
          },
        ],
      };
    case "sdk":
      return addSdk(state, event.message, now);
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
          },
        ],
      };
    case "permission_resolved":
      return {
        ...state,
        requests: state.requests.filter((r) => r.requestId !== event.requestId),
      };
    case "context":
      return { ...state, context: { percentage: usableContextPercent(event) } };
    case "usage":
      return addUsage(state, event.rateLimits);
    case "info":
      return {
        ...state,
        title: event.title ?? state.title,
        gitBranch:
          event.gitBranch === undefined ? state.gitBranch : event.gitBranch,
      };
    case "history":
      return event.agentId
        ? state
        : addHistory(state, event.messages, event.truncated);
    case "closed":
      return {
        ...endTurn(state),
        requests: [],
        closed: { error: event.error },
      };
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
