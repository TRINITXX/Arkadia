import type {
  ChatEvent,
  JsonObject,
  SlashCommandInfo,
} from "@/lib/chat/chatProtocol";
import {
  isListed,
  parseSlash,
  refusedCommand,
  terminalOnlyNotice,
} from "@/lib/chat/chatSlash";
import type { ChatItem, ChatState } from "@/lib/chat/chatState";

/**
 * Slash commands in the column, for `reduceChat`: a command sent shows as a
 * card (« /context ») that its local answer fills, /clear starts the column
 * over, and /compact's summary never shows as the user's words. Pure.
 */

export type CommandItem = Extract<ChatItem, { kind: "command" }>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");

const CLEAR_NAMES = new Set(["clear", "reset", "new"]);

/** How Claude Code opens the summary that replaces a compacted conversation. */
const COMPACT_SUMMARY =
  "This session is being continued from a previous conversation";

/** Claude Code's command list, as `commands_changed` or `commands` carry it. */
export function commandList(v: unknown): SlashCommandInfo[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw: unknown) => {
    const c = raw as Partial<SlashCommandInfo> | null;
    if (!c || typeof c.name !== "string") return [];
    return [
      {
        name: c.name,
        description: typeof c.description === "string" ? c.description : "",
        argumentHint: typeof c.argumentHint === "string" ? c.argumentHint : "",
        aliases: Array.isArray(c.aliases)
          ? c.aliases.filter((a): a is string => typeof a === "string")
          : undefined,
        builtin: c.builtin === true || undefined,
      },
    ];
  });
}

/** A command's answer: the card filled, or the French notice for a refusal. */
function filled(
  card: CommandItem,
  output: string,
  absorbed: string[],
): ChatItem {
  const clean = output.replace(ANSI, "").trim();
  const refused = refusedCommand(clean);
  if (refused) {
    return {
      kind: "notice",
      id: card.id,
      text: terminalOnlyNotice(refused),
      tone: "info",
      command: true,
      at: card.at,
    };
  }
  return { ...card, output: clean, absorbed };
}

type UserSent = Extract<ChatEvent, { type: "user_sent" }>;

/** A slash command Claude Code knows (an unknown `/x` goes to Claude as words). */
export function isCommandSent(state: ChatState, event: UserSent): boolean {
  const cmd = parseSlash(event.text);
  return (
    !!cmd &&
    event.images === 0 &&
    isListed(state.commands, state.slashCommands, cmd.name)
  );
}

/** A command sent (`isCommandSent`): its card instead of a bubble. */
export function addCommandSent(
  state: ChatState,
  event: UserSent,
  now: number,
): ChatState {
  const cmd = parseSlash(event.text);
  if (!cmd) return state;
  const card: CommandItem = {
    kind: "command",
    id: event.uuid ? `sent:${event.uuid}` : `sent:${now}:${state.items.length}`,
    name: cmd.name,
    args: cmd.args,
    absorbed: [],
    // Claude Code queues it like any message (`takeQueued`).
    ...(state.working && event.uuid ? { queued: true } : {}),
    at: now,
  };
  return {
    ...state,
    working: true,
    turnStartedAt: state.working ? state.turnStartedAt : now,
    turnTokens: state.working ? state.turnTokens : 0,
    closed: null,
    items: [...state.items, card],
  };
}

/**
 * The card a command's answer belongs to: the one Claude Code said it runs
 * (`markCommandStarted`: two commands queued each get their own), else the
 * last command with no message after it (a CLI without lifecycle frames).
 * -1 for none.
 */
function answeredAt(items: ChatItem[]): number {
  const running = items.findIndex((x) => x.kind === "command" && x.running);
  if (running >= 0) return running;
  for (let i = items.length - 1; i >= 0; i--) {
    const kind = items[i].kind;
    if (kind === "command") return i;
    if (kind === "user") return -1;
  }
  return -1;
}

const notRunning = (items: ChatItem[]): ChatItem[] =>
  items.map((x) =>
    x.kind === "command" && x.running ? { ...x, running: false } : x,
  );

/** Claude Code takes a message (`command_lifecycle` « started »): a command's card runs. */
export function markCommandStarted(state: ChatState, m: JsonObject): ChatState {
  if (m.type !== "command_lifecycle" || m.state !== "started") return state;
  const id = `sent:${str(m.command_uuid) ?? ""}`;
  const at = state.items.findIndex((x) => x.id === id);
  const card = state.items[at];
  if (card?.kind !== "command") return state;
  const items = notRunning(state.items);
  items[at] = { ...card, running: true };
  return { ...state, items };
}

/** A turn's end: a local command's answer (`num_turns: 0`) fills its card, and none runs any more. */
export function endCommandTurn(
  state: ChatState,
  result: JsonObject,
): ChatState {
  const next =
    result.num_turns === 0 ? absorbCommandOutput(state, result) : state;
  return next.items.some((x) => x.kind === "command" && x.running)
    ? { ...next, items: notRunning(next.items) }
    : next;
}

/**
 * A turn without the model (`num_turns: 0`) answered a command: the text
 * Claude Code wrote for it moves into its card.
 */
function absorbCommandOutput(state: ChatState, result: JsonObject): ChatState {
  const at = answeredAt(state.items);
  const card = state.items[at];
  if (card?.kind !== "command" || card.output !== undefined) return state;
  const after = state.items.slice(at + 1);
  // A command that waited: the words of the turn it waited for (up to that
  // turn's end) stay Claude's.
  let from = 0;
  after.forEach((x, i) => {
    if (x.kind === "turn") from = i + 1;
  });
  const texts = after
    .slice(from)
    .filter((x): x is Extract<ChatItem, { kind: "text" }> => x.kind === "text");
  const taken = new Set(texts.map((t) => t.id));
  const output =
    texts.map((t) => t.text).join("\n\n") || (str(result.result) ?? "");
  return {
    ...state,
    items: [
      ...state.items.slice(0, at),
      filled(card, output, [...taken]),
      ...after.filter((x) => !taken.has(x.id)),
    ],
  };
}

/** A line the chat server adds itself (the files of /rewind restored). */
export function addServerNotice(
  state: ChatState,
  event: Extract<ChatEvent, { type: "notice" }>,
  now: number,
): ChatState {
  return {
    ...state,
    items: [
      ...state.items,
      {
        kind: "notice",
        id: `n${now}:${state.items.length}`,
        text: event.text,
        tone: event.tone,
        command: true,
        at: now,
      },
    ],
  };
}

/**
 * An assistant message already moved into a command's card: /compact sends
 * the latest ones again, which would show the answer twice.
 */
function isAbsorbed(state: ChatState, m: JsonObject): boolean {
  const uuid = str(m.uuid);
  return (
    !!uuid &&
    state.items.some(
      (x) =>
        x.kind === "command" &&
        x.absorbed.some((id) => id.startsWith(`${uuid}:`)),
    )
  );
}

/**
 * An assistant message that answers a command: Claude Code marks a local
 * command's (`local_command_run`, outside the SDK's types), and it fills the
 * command's card at once. The state as it was for one already in a card,
 * null for Claude's own words (`absorbCommandOutput` still catches an
 * unmarked answer at the turn's end).
 */
export function commandAnswer(
  state: ChatState,
  m: JsonObject,
): ChatState | null {
  if (isAbsorbed(state, m)) return state;
  const run = m.local_command_run as
    | { command?: unknown; args?: unknown }
    | undefined;
  if (!run || typeof run !== "object") return null;
  const content = (m.message as JsonObject | undefined)?.content;
  const blocks = Array.isArray(content) ? (content as JsonObject[]) : [];
  const text = blocks
    .map((b) => (b?.type === "text" ? (str(b.text) ?? "") : ""))
    .join("\n");
  const ids = blocks.map((_, i) => `${str(m.uuid) ?? ""}:${i}`);
  const at = answeredAt(state.items);
  const open = state.items[at];
  const card: CommandItem =
    open?.kind === "command" && open.output === undefined
      ? open
      : {
          kind: "command",
          id: `cmd:${str(m.uuid) ?? state.items.length}`,
          name: str(run.command) ?? "?",
          args: str(run.args) ?? "",
          absorbed: [],
        };
  const items = state.items.slice();
  if (card === open) items[at] = filled(card, text, ids);
  else items.push(filled(card, text, ids));
  return { ...state, items };
}

/**
 * /clear (or a plan approved on a clean context): a new session starts, the
 * column with it. Title, model and the status line stay.
 */
export function resetConversation(state: ChatState, m: JsonObject): ChatState {
  return {
    ...state,
    items: [
      {
        kind: "notice",
        id: `reset:${str(m.uuid) ?? state.items.length}`,
        text: "Nouvelle conversation",
        tone: "info",
        command: true,
      },
    ],
    subagents: [],
    requests: [],
    historyTruncated: false,
    // None until the next message's init: the cleared one is over.
    sessionId: null,
  };
}

function userText(m: JsonObject): string | null {
  const content = (m.message as JsonObject | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const blocks = content as JsonObject[];
  if (blocks.some((b) => b?.type !== "text")) return null;
  return blocks.map((b) => str(b.text) ?? "").join("\n");
}

/**
 * A past user message that is about a command: the command itself (tagged
 * by the terminal, plain from a chat), its output, or /compact's summary.
 * Null for any other message.
 */
export function addHistoryCommand(
  state: ChatState,
  m: JsonObject,
): ChatState | null {
  const raw = userText(m);
  if (raw === null) return null;
  const text = raw.trim();
  const id = str(m.uuid) ?? `h${state.items.length}`;
  if (text.startsWith(COMPACT_SUMMARY)) {
    return {
      ...state,
      items: [
        ...state.items,
        { kind: "notice", id, text: "Conversation compactée", tone: "info" },
      ],
    };
  }
  const named = /<command-name>\/?([^<]*)<\/command-name>/.exec(text);
  // The first message of a session /clear opened.
  if (named && CLEAR_NAMES.has(named[1].trim())) {
    return {
      ...state,
      items: [
        ...state.items,
        {
          kind: "notice",
          id,
          text: "Nouvelle conversation",
          tone: "info",
          command: true,
        },
      ],
    };
  }
  if (named) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text);
    const card: CommandItem = {
      kind: "command",
      id,
      name: named[1].trim(),
      args: args?.[1].trim() ?? "",
      absorbed: [],
    };
    return { ...state, items: [...state.items, card] };
  }
  const out =
    /^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/.exec(text);
  if (!out) return null;
  const items = state.items.slice();
  const last = items[items.length - 1];
  if (last?.kind === "command" && last.output === undefined) {
    items[items.length - 1] = filled(last, out[2], []);
  } else if (last?.kind === "user" && last.images === 0) {
    // A chat's command is stored as its plain text.
    const cmd = parseSlash(last.text);
    if (cmd) {
      items[items.length - 1] = filled(
        {
          kind: "command",
          id: last.id,
          name: cmd.name,
          args: cmd.args,
          absorbed: [],
        },
        out[2],
        [],
      );
    }
  }
  return { ...state, items };
}
