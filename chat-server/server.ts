// Arkadia's chat server: drives Claude Code through the Agent SDK for the
// chat view, with no terminal. One process per Claude account (Arkadia sets
// CLAUDE_CONFIG_DIR for a secondary one, so the SDK's own session readers
// look in the right folder). It speaks NDJSON on stdio: commands in, events
// out. Every SDK message goes out as is: the page turns them into a chat.
//
// The conversation lives here, not in the page: each chat keeps the events of
// its life, and a page that reloads (Arkadia's watchdog rebuilds its window)
// gets them again by starting the same chat, while Claude goes on working.

import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  bangBlocks,
  entriesEnd,
  BANG_SHOWN_MAX,
  BANG_SENT_MAX,
  keep,
  keptText,
  NOTHING_KEPT,
  runBang,
  type BangRun,
  type Kept,
} from "./bash.ts";
import { pipeGone, strayVerdict } from "./guard.ts";
import {
  cronCount,
  DEFAULT_SLEEP_MS,
  queuedAfter,
  readSleepAfter,
  SLEEP_CHECK_MS,
  sleepDue,
  tasksAfter,
  turnAfter,
  type SleepFacts,
} from "./sleep.ts";
import { needsReread, outputFiles, readConsoleTail } from "./taskOutput.ts";
import { storedVisual, visualServer, VISUAL_RULE, type PreparedVisual } from "./visual.ts";
import { readVisualReport, VISUAL_SERVER, VISUAL_TOOL_NAME, type VisualReport } from "./visualHtml.ts";
import { WorkflowWatch, type WorkflowLiveAgent } from "./workflowWatch.ts";
import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSessions,
  query,
  type CanUseTool,
  type EffortLevel,
  type ElicitationRequest,
  type ElicitationResult,
  type ModelInfo,
  type OnElicitation,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKControlGetUsageResponse,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

type ImageInput = { mediaType: string; data: string; label?: string };

export type Command =
  | {
      type: "start";
      chatId: string;
      cwd: string;
      /** Session to continue (one the terminal ran too). */
      resume?: string;
      /** The folder's latest session (the terminal's `ccdr`). */
      continue?: boolean;
      permissionMode?: PermissionMode;
      model?: string;
      /** Per-chat variables for Claude Code and its hooks (ARKADIA_PANE_ID…). */
      env?: Record<string, string>;
      /** The session's effort, for this session only (a restart keeps it). */
      effort?: EffortLevel;
      /**
       * The page shows this conversation already (a restart after the server
       * stopped): the past goes to the log only, for a later reload.
       */
      keep?: boolean;
      /** That restart cut a turn: the column says so (`RESTART_CUT`). */
      cut?: boolean;
      /** Starts asleep (it was when the server stopped): no Claude Code until woken. */
      asleep?: boolean;
      /**
       * A /rewind's cut the page carries over a restart (`info.rewind`): the
       * past stops before `historyBefore`, Claude Code resumes at
       * `resumeSessionAt`, never on the turns rewound away.
       */
      historyBefore?: string;
      resumeSessionAt?: string;
      /** The Lab's setting, for the whole server (`sleep.ts`); null: never. */
      sleepAfterMs?: number | null;
    }
  | {
      type: "send";
      chatId: string;
      text: string;
      images?: ImageInput[];
      /** The texts in `text` pasted as tags: told back in `user_sent`. */
      pastes?: string[];
      /** « Envoyer maintenant »: Claude Code stops the turn under way for it. */
      priority?: "now";
      /**
       * Sent now while foreground Agent calls run: queued as any message, then
       * these go to the background, and Claude takes it at that boundary (a
       * `now` would end their turn, and them with it).
       */
      spare?: string[];
    }
  /** Esc. `spare`: running foreground Agent calls sent to the background first. */
  | { type: "interrupt"; chatId: string; spare?: string[] }
  | {
      type: "answer";
      chatId: string;
      requestId: string;
      result: PermissionResult;
    }
  | { type: "set_mode"; chatId: string; mode: PermissionMode }
  | { type: "set_model"; chatId: string; model: string }
  /** A subagent's conversation (its sheet): never the session's, whatever comes. */
  | { type: "agent_history"; chatId: string; sessionId: string; cwd: string; limit: number; agentId: string; to?: string }
  | {
      type: "history";
      chatId: string;
      sessionId: string;
      cwd: string;
      /** Only the latest messages: a long session holds thousands. */
      limit: number;
      /** A subagent's own conversation instead of the session's. */
      agentId?: string;
      /** The phone that asked (`phone:<client>`): the answer goes to it alone. */
      to?: string;
    }
  /** /resume's list: the folder's sessions. */
  | { type: "sessions"; chatId: string; requestId: string }
  /** /rewind's list: the messages the user wrote in this conversation. */
  | { type: "rewind_points"; chatId: string; requestId: string }
  /**
   * The chat's Claude Code again, on another session (`resume`) or on its own
   * cut just before a message of the user (`rewind`), files too with `code`.
   */
  | {
      type: "relaunch";
      chatId: string;
      resume?: string;
      rewind?: { before: string; code: boolean };
    }
  /** /rewind's « code seul »: the files as they were before the message. */
  | { type: "restore_code"; chatId: string; before: string }
  /** Ctrl+B: the running Bash commands and subagents go to the background. */
  /** Ctrl+B (all foreground tasks), or these Agent calls only (`toolUseIds`). */
  | { type: "background"; chatId: string; toolUseIds?: string[] }
  /** Stops one background task (« Arrêter le workflow »). */
  | { type: "stop_task"; chatId: string; taskId: string }
  /** The end of a background shell's output, answered by `task_output`. */
  | { type: "task_output"; chatId: string; taskId: string; to?: string }
  /** « Charger les messages plus anciens »: the page before `before`. */
  | { type: "older"; chatId: string; before: string; limit: number; to?: string }
  /** The session's effort, for this session only: never saved. */
  | { type: "set_effort"; chatId: string; effort: EffortLevel }
  /** Withdraws a message Claude hasn't taken yet. */
  | { type: "cancel_queued"; chatId: string; uuid: string }
  /** A key typed in the input of a chat asleep: its Claude Code starts again. */
  | { type: "wake"; chatId: string }
  /** Puts the chat to sleep now if nothing runs nor waits in it (tests, checks). */
  | { type: "sleep"; chatId: string }
  /** The Lab's setting changed: for the whole server; null: never. */
  | { type: "sleep_after"; chatId: string; ms: number | null }
  /** The pane shows again (or the window came back): the branch looked at anew. */
  | { type: "refresh_branch"; chatId: string }
  /** `!command` in the input: run in the chat's folder, its output to Claude with the next message. */
  | { type: "bash"; chatId: string; id: string; command: string }
  /** Esc on a running `!` command. */
  | { type: "bash_stop"; chatId: string; id: string }
  /** The page's answer to an MCP server's request. */
  | { type: "elicit_answer"; chatId: string; requestId: string; result: ElicitationResult }
  /** The context by category (token counts: asked on hover only). `to`: a phone's ask. */
  | { type: "context_detail"; chatId: string; requestId: string; to?: string }
  /** The MCP servers' state again (their list opened). */
  | { type: "mcp_status"; chatId: string }
  /** /mcp's buttons: a sign-in, a reconnection, a server on or off. */
  | {
      type: "mcp_action";
      chatId: string;
      requestId: string;
      server: string;
      action: "connect" | "reconnect" | "enable" | "disable";
    }
  /** Plugins and skills read again from disk. */
  | { type: "reload_plugins"; chatId: string }
  /** The page rendered a visual (`visual_check`): what broke, for the tool's result. */
  | { type: "visual_report"; chatId: string; checkId: string; report: unknown }
  /** A past visual's page with its images in (`storedVisual`), for a resumed chat. */
  | { type: "visual_html"; chatId: string; toolUseId: string; to?: string }
  /**
   * The phone opened the chat: its life replayed to that phone alone (`to`,
   * `phone:<client>`), never to the page, which shows it already.
   */
  | { type: "phone_replay"; chatId: string; to: string }
  /** « Ouvrir dans le navigateur »: the page as the column shows it, theme in. */
  | { type: "visual_open"; chatId: string; html: string; title: string }
  | { type: "close"; chatId: string };

type StartCommand = Extract<Command, { type: "start" }>;

/**
 * A start, plus what a /rewind relaunch adds (`Chat.relaunchStart`): its cut
 * (`resumeSessionAt`, `historyBefore`, a start's own fields too) and what
 * the new column says first (the files restored).
 */
type Boot = StartCommand & { notice?: string };

type SlashCommandInfo = Awaited<ReturnType<Query["supportedCommands"]>>[number];

/** What the user typed, waiting its turn to reach Claude Code (`Chat.outbox`). */
type Outgoing =
  | {
      kind: "message";
      uuid: string;
      message: SDKUserMessage;
      /** Handed to Claude Code (true), or withdrawn / the chat closed (false). */
      sent: (pushed: boolean) => void;
    }
  /** A `!` command: its two entries once it ended, null while it runs. */
  | { kind: "bash"; id: string; entries: SDKUserMessage[] | null };

/** An MCP server as the page lists it. */
type McpServerInfo = { name: string; status: string; error?: string; source?: string };

/** Query methods the SDK has but doesn't type (sdk.mjs, 0.3.314). */
type QueryExtras = {
  /** True when the message was still queued and is gone. */
  cancelAsyncMessage(uuid: string): Promise<boolean>;
  /** `applied.effort`: what the next message runs at (`init` lacks it here). */
  getSettings(): Promise<{ applied?: { effort?: EffortLevel | null } }>;
};
const extras = (q: Query) => q as Query & QueryExtras;

/** Polls the MCP servers' state while some still connect, this many times. */
const MCP_POLL_MS = 5_000;
const MCP_POLLS = 12;
/** A sign-in opened in the browser is looked at this often, this many times (3 min). */
const MCP_SIGNIN_MS = 5_000;
const MCP_SIGNIN_LOOKS = 36;

/**
 * Not in the SDK's types (0.3.314), but there: `mcp_authenticate` gives the
 * page to sign in on (probe of 01/11/2026: an MCP of the user's with a
 * localhost callback, a claude.ai connector with none).
 */
interface McpSignIn {
  mcpAuthenticate(server: string): Promise<{ authUrl?: string; callbackExpected?: boolean } | undefined>;
}

/** How long a visual waits for the page's report before it is « not verified ». */
const VISUAL_CHECK_MS = 8_000;

/**
 * The account this server runs for (`chat.rs`): a visual's check names it,
 * so a page reloaded meanwhile sends its report here. Not passed on to
 * Claude Code: it is the server's own.
 */
const ACCOUNT = process.env.ARKADIA_CHAT_ACCOUNT ?? null;
delete process.env.ARKADIA_CHAT_ACCOUNT;

export type ServerEvent =
  /** A start found the chat running: its events follow, from the beginning. */
  | { type: "attached"; chatId: string }
  /** The end of that replay. */
  | { type: "replayed"; chatId: string }
  | { type: "sdk"; chatId: string; message: SDKMessage }
  /** What the user sent: the SDK doesn't echo it. */
  | {
      type: "user_sent";
      chatId: string;
      text: string;
      images: number;
      /** The pasted images themselves, for the message's strip in the page. */
      pasted: ImageInput[];
      /** The texts it sent from tags: tags again in its frame, the phone's too. */
      pastes?: string[];
      /** Its `command_lifecycle` frames name it: « started » once Claude takes it. */
      uuid: string;
    }
  | {
      type: "permission";
      chatId: string;
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      toolUseId: string;
      title?: string;
      description?: string;
      decisionReason?: string;
      /** What would stop Claude Code asking: the « always allow » buttons. */
      suggestions?: PermissionUpdate[];
      /** Who asks and on what, and how cautious the panel must be. */
      displayName?: string;
      defaultToNo?: boolean;
      suppressAlwaysAllowRule?: boolean;
      agentId?: string;
      blockedPath?: string;
      mcpServer?: { name: string; source: string };
    }
  /** Answered by the page, or dropped by Claude Code (interrupt, timeout). */
  | { type: "permission_resolved"; chatId: string; requestId: string }
  /**
   * What a message Claude Code took was, when the page doesn't show it (an
   * echo `isEcho` drops): its `origin.kind`, and whether it is an artifact
   * comment or a cross-session idle notice. Who opened a turn, for the
   * notifications (`chatNotify`).
   */
  | {
      type: "user_origin";
      chatId: string;
      kind: string | null;
      artifact: boolean;
      idleNotice: boolean;
    }
  /** The model menu (`supportedModels`). */
  | { type: "models"; chatId: string; models: ModelInfo[] }
  /** The effort the next message runs at; null: the model takes none. */
  | { type: "effort"; chatId: string; effort: EffortLevel | null }
  /** The MCP servers and their state, sent when it changes. */
  | { type: "mcp"; chatId: string; servers: McpServerInfo[] }
  /** An MCP server asks the user something (`onElicitation`). */
  | { type: "elicitation"; chatId: string; requestId: string; request: ElicitationRequest }
  /** Answered by the page, or dropped by Claude Code. */
  | { type: "elicitation_resolved"; chatId: string; requestId: string }
  /** A message the user withdrew before Claude took it. */
  | { type: "queued_removed"; chatId: string; uuid: string }
  /** The answer to `mcp_action`: a sign-in's page, or why it failed. */
  | {
      type: "mcp_action_done";
      chatId: string;
      requestId: string;
      /** The page to sign in on, for the browser; none once connected. */
      authUrl?: string;
      error?: string;
    }
  /** The answer to `context_detail` (not kept for a replay). */
  | {
      type: "context_detail";
      chatId: string;
      requestId: string;
      detail?: {
        categories: { id?: string; name: string; tokens: number; kind: string }[];
        totalTokens: number;
        rawMaxTokens: number;
        memoryFiles: { path: string; tokens: number }[];
      };
      error?: string;
    }
  | {
      type: "context";
      chatId: string;
      percentage: number;
      totalTokens: number;
      maxTokens: number;
      /** The session's model now: `/model` changes it without an init. */
      model: string;
    }
  /** The session's title and the folder's git branch (null: none). */
  | {
      type: "info";
      chatId: string;
      title?: string;
      gitBranch?: string | null;
      /** The session resumed: its init only comes with the first turn. */
      sessionId?: string;
      /** The mode it starts in: the init that says it comes with a turn. */
      mode?: PermissionMode;
      /**
       * A /rewind's cut nothing was sent after yet (null: gone): a restart
       * after the server stopped resumes at it, never past it.
       */
      rewind?: { before: string; at: string } | null;
    }
  /** Claude Code's slash commands, for the page's `/` menu. */
  | { type: "commands"; chatId: string; commands: SlashCommandInfo[] }
  /** A line of the server's own in the column (files of /rewind restored). */
  | { type: "notice"; chatId: string; text: string; tone: "info" | "error" }
  | {
      type: "sessions";
      chatId: string;
      requestId: string;
      sessions: {
        sessionId: string;
        title: string;
        lastModified: number;
        gitBranch?: string;
        /** Open in another chat of this server. */
        open?: boolean;
      }[];
      error?: string;
    }
  | {
      type: "rewind_points";
      chatId: string;
      requestId: string;
      points: { uuid: string; text: string; timestamp?: string }[];
      error?: string;
    }
  /** The plan's quota windows (`/usage`); null where none apply (API key). */
  | {
      type: "usage";
      chatId: string;
      rateLimits: SDKControlGetUsageResponse["rate_limits"];
    }
  | {
      type: "history";
      chatId: string;
      agentId?: string;
      messages: unknown[];
      /** More messages exist before the first one sent. */
      truncated: boolean;
      /** A page before the oldest shown: not kept in the log. */
      older?: boolean;
      /** Before a compaction since: nothing older can be read. */
      unreachable?: boolean;
    }
  /** A running workflow's agents from its folder (`WorkflowWatch`). */
  | { type: "workflow_live"; chatId: string; taskId: string; agents: WorkflowLiveAgent[] }
  /**
   * Claude called `show_visual`: the page, its local images in, for the
   * column's card and for the page's offscreen check (`visual_report`).
   */
  | {
      type: "visual_check";
      chatId: string;
      checkId: string;
      toolUseId: string | null;
      /** Sent live only: the log keeps the check without its page (null). */
      html: string | null;
      title: string;
      wide: boolean;
      /** A copy with its images in was kept: `visual_html` gives it. */
      stored: boolean;
      /** This server's account (`chat.rs`): where the page sends its report. */
      account: string | null;
    }
  /** That check is over (reported, or timed out): a replay doesn't check it again. */
  | { type: "visual_checked"; chatId: string; checkId: string }
  /** The answer to `visual_html` (not kept for a replay); null: none kept. */
  | { type: "visual_html"; chatId: string; toolUseId: string; html: string | null }
  /** The end of a background shell's output (not kept for a replay). */
  | {
      type: "task_output";
      chatId: string;
      taskId: string;
      output: string;
      truncated: boolean;
      error?: string;
    }
  /** Its Claude Code stopped while nothing ran (`sleep.ts`): the column stays as is. */
  | { type: "asleep"; chatId: string }
  /** It starts again on the session (a key typed, a command sent). */
  | { type: "awake"; chatId: string }
  /**
   * A `!` command: `running` when it starts, then its end with what the
   * column keeps of each stream; `sent` of `total` characters go to Claude.
   */
  | {
      type: "bash";
      chatId: string;
      id: string;
      command: string;
      state: "running" | "done";
      stdout?: string;
      stderr?: string;
      /** Bash's exit code; null when stopped or never started. */
      code?: number | null;
      stopped?: boolean;
      error?: string;
      sent?: number;
      total?: number;
    }
  /** That command's entries are written: the chat no longer waits on it. */
  | { type: "bash_written"; chatId: string; id: string }
  /** A running `!` command's output as it comes (not kept for a replay). */
  | { type: "bash_output"; chatId: string; id: string; stream: "stdout" | "stderr"; text: string }
  | { type: "closed"; chatId: string; error?: string }
  | { type: "error"; chatId?: string; message: string };

/**
 * Writes an event for Arkadia. With `to` (`phone:<client>`), Rust hands it to
 * that phone alone, never to the page: a phone's replay, or the answer to a
 * phone's own read (`RemoteHub::chat_line`).
 */
function emit(event: ServerEvent, to?: string): void {
  let line: string;
  try {
    line = JSON.stringify(to ? { ...event, to } : event);
  } catch (e) {
    // An event that won't serialize ends nothing: its chat hears why.
    line = JSON.stringify({
      type: "error",
      chatId: "chatId" in event ? event.chatId : undefined,
      message: `Événement illisible (${event.type}) : ${String(e)}`,
    });
  }
  process.stdout.write(`${line}\n`);
}

/** The phone a command came from (`to` of its reads), for its error too. */
function replyTo(cmd: Command): string | undefined {
  return "to" in cmd && typeof cmd.to === "string" ? cmd.to : undefined;
}

/** The user's Claude Code, so the chat runs the same version as the terminal. */
function claudeExecutable(): string | undefined {
  const local = join(homedir(), ".local", "bin", "claude.exe");
  if (existsSync(local)) return local;
  for (const dir of (process.env.PATH ?? "").split(";")) {
    const exe = join(dir, "claude.exe");
    if (dir && existsSync(exe)) return exe;
  }
  return undefined;
}

/**
 * The folder's branch as the status line reads it: null when detached or no
 * repo (git exits 128), undefined when git failed otherwise (timeout, spawn).
 */
function gitBranch(cwd: string): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["symbolic-ref", "--short", "HEAD"],
      { cwd, windowsHide: true, timeout: 5_000 },
      (error, stdout) => {
        if (!error) resolve(stdout.trim() || null);
        else resolve(error.code === 128 ? null : undefined);
      },
    );
  });
}

/** A queue the SDK reads as its prompt stream: one message per user turn. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private ended = false;

  push(message: SDKUserMessage): void {
    if (this.ended) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: message, done: false });
    } else {
      this.items.push(message);
    }
  }

  end(): void {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

/** How long a message sent now waits for Claude Code to have it queued. */
const LIFECYCLE_WAIT_MS = 2_000;

/** Past this, the oldest events of a long chat are dropped from its log. */
const LOG_LIMIT = 20_000;

/** How much of a resumed session's past the column gets. */
const HISTORY_LIMIT = 400;

/** Said in the column of a chat whose turn the server's restart cut. */
const RESTART_CUT = "Claude Code a redémarré : le tour en cours a été coupé.";

/** `ready` while asleep: what awaits it without waking hears why. */
function asleepReady(): Promise<Query> {
  const ready = Promise.reject(new Error("Claude est en veille"));
  ready.catch(() => {});
  return ready;
}

/** The Lab's setting, for every chat of this server (`sleep_after`, `start`). */
let sleepAfterMs: number | null = DEFAULT_SLEEP_MS;

class Chat {
  private chatId: string;
  private cwd: string;
  private input = new InputQueue();
  /** The Claude Code running now; null while it starts, and asleep. */
  private query: Query | null = null;
  /** Resolves once the query runs: commands wait for it. A wake replaces it. */
  private ready: Promise<Query>;
  /** The past read at start, resolved once its session is known: a wake waits for it too. */
  private past: Promise<void>;
  /** No Claude Code runs: what needs one wakes it (`awake`), the column stays. */
  private asleep = false;
  /** A compaction since the last turn's end: the ring counts again then. */
  private compacted = false;
  /** What keeps it awake (`SleepFacts`), from its messages and the page's commands. */
  private turn = false;
  private tasks: readonly string[] = [];
  private queued: readonly string[] = [];
  private crons = 0;
  /** The last thing done in it: a command of the user, a message of Claude Code. */
  private lastActive = Date.now();
  /** The effort set for this session (never saved): a wake applies it again. */
  private effort: EffortLevel | undefined;
  /** The user's `!` commands still running, by id. */
  private bangs = new Map<string, BangRun>();
  /**
   * What goes to Claude Code, in the order the user typed it: a message, or
   * a `!` command's two entries once it ended. A command still running
   * holds what follows it (its output rides the next message, as in the
   * terminal); a message held there can still be withdrawn (`cancelQueued`).
   */
  private outbox: Outgoing[] = [];
  /**
   * The `!` entries handed to Claude Code, by uuid. Claude Code ends a turn
   * of its own for them, without the model (`num_turns` 0, its
   * `user_message_uuids` naming them, seen live on 01/11/2026): no one's
   * turn, the page never sees those ends (no « fin de tour », no
   * notification, no slash command's card filled by them).
   */
  private entries = new Set<string>();
  /**
   * Those not written yet, with their command's id: the chat isn't at rest.
   * Once a command's last one is written, the page hears `bash_written`
   * (the server alone decides: a lifecycle frame or the turn that took it).
   */
  private writing = new Map<string, string>();
  /**
   * Ended (closed, its Claude Code gone, it never started): a command that
   * ends now tells no one and hands nothing (`bash`), never after `closed`.
   */
  private ended = false;
  /** Permission requests waiting for the page, by SDK request id. */
  private pending = new Map<string, (result: PermissionResult) => void>();
  /** Running workflows' folders watched (`WorkflowWatch`), by task id. */
  private workflows = new Map<string, { watch: WorkflowWatch; latest?: ServerEvent }>();
  /** Messages waiting for their first `command_lifecycle` frame (Claude Code has them). */
  private lifecycleWaiters = new Map<string, () => void>();
  /** Everything sent to the page, for a page that comes back. */
  private log: ServerEvent[] = [];
  private sessionId: string | undefined;
  /**
   * The branch last sent; undefined before the first look. Looked at when
   * the chat starts, at each turn's end, and when its pane shows again
   * (`refresh_branch`): never in a loop, a hidden or idle chat costs nothing.
   */
  private branch: string | null | undefined;
  private branchLooking = false;
  /** What started it: a relaunch (/resume, /rewind) keeps its env. */
  private start: Boot;
  /** The session's mode and model now: a relaunch keeps them too. */
  private mode: PermissionMode | undefined;
  private model: string | undefined;
  /** Rewound and nothing sent since: the transcript still ends past the cut. */
  private cutBefore: string | undefined;
  /** Stopped for a relaunch: nothing more reaches the page. */
  private silent = false;
  private pumping: Promise<void> = Promise.resolve();
  /** The latest command list: a replay sends it first, the log may have lost it. */
  private commands: SlashCommandInfo[] | undefined;
  /** MCP servers' requests waiting for the page, by SDK request id. */
  private elicitations = new Map<string, (result: ElicitationResult) => void>();
  /** What the page last got of these: sent again only when it changes. */
  private effortSent: string | undefined;
  private mcpSent: string | undefined;
  private mcpTimer: ReturnType<typeof setTimeout> | undefined;
  /** Sign-ins the user opened in the browser, looked at until connected. */
  private signIns = new Map<string, ReturnType<typeof setTimeout>>();
  /** Background shells' output files, by task id (`noteOutputFiles`). */
  private outputFiles = new Map<string, string>();
  /** Visuals waiting for the page's report, by check id (`checkVisual`). */
  private visualChecks = new Map<string, (report: VisualReport | null) => void>();
  /** Their pages, while their check is open: a reattached page checks them. */
  private visualPages = new Map<string, ServerEvent>();

  // No parameter properties: Node runs this file by stripping its types.
  constructor(chatId: string, start: Boot) {
    this.chatId = chatId;
    this.cwd = start.cwd;
    this.start = start;
    this.mode = start.permissionMode;
    this.model = start.model;
    this.effort = start.effort;
    this.cutBefore = start.historyBefore;
    if (start.notice) this.out({ type: "notice", chatId, text: start.notice, tone: "info" });
    if (start.cut) this.out({ type: "notice", chatId, text: RESTART_CUT, tone: "error" });
    // The page keeps the cut: a restart after the server stopped resumes at it.
    if (start.historyBefore && start.resumeSessionAt) {
      const rewind = { before: start.historyBefore, at: start.resumeSessionAt };
      this.out({ type: "info", chatId, rewind });
    }
    this.past = this.readPast(start);
    if (start.asleep) {
      this.asleep = true;
      this.ready = asleepReady();
      this.out({ type: "asleep", chatId });
      this.past.catch((e: unknown) => this.end(String(e)));
    } else {
      this.ready = this.launch();
    }
  }

  /** The chat ended on an error of its own: said, and forgotten by the server. */
  private end(error: string): void {
    this.out({ type: "closed", chatId: this.chatId, error });
    this.finish();
    if (chats.get(this.chatId) === this) chats.delete(this.chatId);
  }

  /**
   * The chat is over (closed, its Claude Code gone by itself, it never
   * started): its `!` commands killed, what waited to go dropped, and
   * nothing of them reaches the page after its `closed`.
   */
  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.stopped = this.stopBangs();
    for (const held of this.outbox) if (held.kind === "message") held.sent(false);
    this.outbox = [];
    this.writing.clear();
  }

  /**
   * A resumed session first gets its past, kept in the log like the rest:
   * read before Claude Code runs, it holds nothing of this chat. `continue`
   * becomes the folder's latest session, so its past can be read too. A
   * page that shows it already (`keep`) gets nothing now: the log keeps it
   * for a reload.
   */
  private async readPast(start: Boot): Promise<void> {
    const tell = (event: ServerEvent) => {
      if (start.keep) this.remember(event);
      else this.out(event);
    };
    let resume = start.resume;
    if (!resume && start.continue) {
      const [latest] = await listSessions({ dir: start.cwd, limit: 1 });
      resume = latest?.sessionId;
      // Nothing to go on with: the page stops waiting for a past.
      if (!resume) tell({ type: "history", chatId: this.chatId, messages: [], truncated: false });
    }
    if (!resume) return;
    this.sessionId = resume;
    const all = await getSessionMessages(resume, { dir: start.cwd });
    // Rewound: what follows the message gone back to isn't the past any more.
    const cut = all.findIndex((m) => m.uuid === start.historyBefore);
    const kept = cut >= 0 ? all.slice(0, cut) : all;
    const messages = kept.slice(-HISTORY_LIMIT);
    tell({
      type: "history",
      chatId: this.chatId,
      messages,
      truncated: kept.length > messages.length,
    });
    void this.reportInfo();
  }

  /** Starts its Claude Code once the past is read: at start, and at each wake. */
  private launch(): Promise<Query> {
    const run = this.past.then(() => this.run());
    run.catch((e: unknown) => {
      // Put to sleep or woken again meanwhile: that run is no one's end.
      if (this.ready === run) this.end(String(e));
    });
    return run;
  }

  /**
   * Claude Code on the chat's session as it is now: its model, mode and
   * effort, the env of its start (account, pane id, Lab marker). A rewind
   * nothing was sent after still stops at its cut. Each run picks the
   * installed Claude Code again: a wake takes a newer one (`claude update`).
   */
  private async run(): Promise<Query> {
    const start = this.start;
    // A new process has no background task yet: its set comes with the first change.
    this.tasks = [];
    const q = query({
      prompt: this.input,
      options: {
        cwd: start.cwd,
        resume: this.sessionId,
        resumeSessionAt: this.cutBefore ? start.resumeSessionAt : undefined,
        // /rewind's « le code aussi »: the terminal keeps these backups too.
        enableFileCheckpointing: true,
        model: this.model,
        // As the terminal's `ccd`: auto mode, bypass reachable by Shift+Tab.
        permissionMode: this.mode ?? "auto",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        // The next message, grey in the empty input after a turn.
        promptSuggestions: true,
        pathToClaudeCodeExecutable: claudeExecutable(),
        // Claude Code gives the terminal its claude.ai publish tools
        // (Artifact, ArtifactComments, ArtifactData) by itself, an SDK
        // session only when asked (seen 01/11/2026: « cette session n'a pas
        // l'outil de publication »). A value already set wins.
        env: {
          CLAUDE_CODE_ARTIFACT: "1",
          ...process.env,
          ...start.env,
        } as Record<string, string>,
        canUseTool: (toolName, input, options) =>
          this.askPage(toolName, input, options),
        // An MCP server's form or sign-in page: asked in the page, never declined unseen.
        onElicitation: (request, options) => this.askElicitation(request, options),
        // « hook … en cours » in the live line, a failed hook in the column.
        includeHookEvents: true,
        // The wakeups Claude scheduled, said at each turn's end: asleep, they
        // would never fire, so they keep the chat awake (`SleepFacts.crons`).
        hooks: { Stop: [{ hooks: [async (input) => this.noteCrons(input)] }] },
        // Esc stops Claude's turn only: background agents and workflows go
        // on (verified live 31/10/2026); the page stops a workflow by its card.
        perTaskStopAffordance: true,
        // A running subagent's card: a line of what it does, every ~30 s.
        agentProgressSummaries: true,
        // Its text too, not only its tool calls: its sheet follows it live.
        forwardSubagentText: true,
        // The CLI echoes each user message: the only way another session's
        // message (SendMessage) reaches the page live, seen on 31/10/2026.
        // The others are dropped in `pump` (`isEcho`).
        //
        // Claude in Chrome: the terminal turns it on from the account's
        // setting, an SDK session only with `--chrome` (checked 01/11/2026:
        // without it, no claude-in-chrome among its MCP servers).
        // Claude's thinking in words: the terminal asks for its summaries
        // (`showThinkingSummaries`), an SDK session gets empty thinking
        // blocks unless `--thinking-display summarized` (checked 01/11/2026:
        // 0 characters without, 245 with). It keeps the model's own thinking.
        extraArgs: {
          "replay-user-messages": null,
          chrome: null,
          "thinking-display": "summarized",
        },
        // Another session's message always comes in, whatever the sender's
        // mode: the user's choice (31/10/2026), and the chat has no accept
        // button for a held one. Session only, never written to a file.
        settings: { crossSessionInbound: "accept" },
        // `show_visual`: a page inline in the column, checked by the page
        // before the user sees it. It shows and touches nothing: never asked.
        mcpServers: { [VISUAL_SERVER]: visualServer((v) => this.checkVisual(v)) },
        allowedTools: [VISUAL_TOOL_NAME],
        // Claude Code's own prompt, as in the terminal (the user's pick of
        // 31/10/2026): left out, the SDK runs a near-empty one. Plus the rule
        // of a visual against an artifact.
        systemPrompt: { type: "preset", preset: "claude_code", append: VISUAL_RULE },
        stderr: (data) => process.stderr.write(`[${this.chatId}] ${data}`),
      },
    });
    this.query = q;
    // The input's mode chip before any turn: the init only comes with one.
    this.out({ type: "info", chatId: this.chatId, mode: this.mode ?? "auto" });
    this.pumping = this.pump(q);
    // The effort chosen for this session, again on a new process.
    const effort = this.effort;
    if (effort) {
      void q
        .applyFlagSettings({ effortLevel: effort })
        .then(() => this.reportEffort(q))
        .catch(() => {});
    }
    // The status bar's figures before any turn: these answer without one.
    void this.reportCommands(q);
    void this.reportUsage(q);
    void this.reportContext(q);
    void this.reportBranch();
    void this.reportModels(q);
    void this.reportEffort(q);
    void this.reportMcp(q, MCP_POLLS);
    return q;
  }

  /** The Stop hook's `session_crons`: the hook itself changes nothing. */
  private async noteCrons(input: unknown): Promise<Record<string, never>> {
    this.crons = cronCount(input);
    return {};
  }

  /** Something done in the chat: its sleep waits from now. */
  touch(): void {
    this.lastActive = Date.now();
  }

  /** What keeps it awake now (`sleepDue`). */
  private sleepFacts(): SleepFacts {
    return {
      turn: this.turn,
      tasks: this.tasks.length,
      // A sign-in open in the browser: its callback goes to this Claude Code.
      requests: this.pending.size + this.elicitations.size + this.signIns.size,
      queued: this.queued.length,
      // Their entries count until Claude Code wrote them.
      bangs: this.bangs.size + this.writing.size,
      crons: this.crons,
    };
  }

  /**
   * Its Claude Code, woken first if asleep: what needs Claude Code (a
   * message, a slash command, a change of model, effort or mode) starts it
   * again on the session, the past shown as it is.
   */
  private awake(): Promise<Query> {
    this.wake();
    return this.ready;
  }

  /**
   * Starts Claude Code again on the session, nothing sent to Claude: a
   * message sent meanwhile waits in the new input and goes once it runs.
   */
  wake(): void {
    if (!this.asleep) return;
    this.asleep = false;
    this.touch();
    this.input = new InputQueue();
    this.out({ type: "awake", chatId: this.chatId });
    this.ready = this.launch();
  }

  /**
   * Puts its Claude Code (and its MCP servers) to sleep when nothing ran in
   * the chat for `afterMs` and nothing runs nor waits: not a word but
   * `asleep`, no `closed` (no turn ended: no notification, no badge).
   * `afterMs` 0: now, if at rest. False when it stays awake.
   */
  sleepIfDue(now: number, afterMs: number | null): boolean {
    // Starting, waking, asleep, or stopped for a relaunch: not now.
    if (this.asleep || this.silent || !this.query) return false;
    if (!sleepDue(this.sleepFacts(), this.lastActive, now, afterMs)) return false;
    const q = this.query;
    this.asleep = true;
    // Its pump ends without a word: it is no longer this chat's query.
    this.query = null;
    this.ready = asleepReady();
    clearTimeout(this.mcpTimer);
    for (const timer of this.signIns.values()) clearTimeout(timer);
    this.signIns.clear();
    this.input.end();
    q.close();
    this.out({ type: "asleep", chatId: this.chatId });
    return true;
  }

  /** The pane shows again: the branch may have changed meanwhile. */
  refreshBranch(): void {
    void this.reportBranch();
  }

  /**
   * A `!` command: it wakes Claude, runs in the chat's folder with the
   * chat's env, streams its output to the page (live only, the log keeps
   * its end), and once it ends, hands Claude the command and its output as
   * Claude Code does, without starting a turn: they ride the next message.
   */
  bash(id: string, command: string): void {
    if (this.bangs.has(id)) return;
    this.wake();
    // Its place in the user's order, filled once it ends.
    const slot: Extract<Outgoing, { kind: "bash" }> = { kind: "bash", id, entries: null };
    this.outbox.push(slot);
    const chatId = this.chatId;
    const env = { ...process.env, ...this.start.env } as Record<string, string>;
    let stdout: Kept = NOTHING_KEPT;
    let stderr: Kept = NOTHING_KEPT;
    this.out({ type: "bash", chatId, id, command, state: "running" });
    const run = runBang(command, this.cwd, env, (stream, text) => {
      const room = Math.max(BANG_SENT_MAX, BANG_SHOWN_MAX);
      if (stream === "stdout") stdout = keep(stdout, text, room);
      else stderr = keep(stderr, text, room);
      if (!this.silent && !this.ended) emit({ type: "bash_output", chatId, id, stream, text });
    });
    this.bangs.set(id, run);
    void run.done.then((end) => {
      this.bangs.delete(id);
      // The chat ended meanwhile (and killed it): no event after its `closed`.
      if (this.ended) return;
      const blocks = bangBlocks(command, stdout, stderr, end.stopped);
      // Claude Code's two entries; they start no turn, the next message takes them.
      slot.entries = end.error
        ? []
        : [blocks.input, blocks.output].map((content) => ({
            type: "user" as const,
            uuid: randomUUID(),
            parent_tool_use_id: null,
            shouldQuery: false,
            message: { role: "user" as const, content },
          }));
      this.touch();
      this.out({
        type: "bash",
        chatId,
        id,
        command,
        state: "done",
        stdout: keptText(stdout, BANG_SHOWN_MAX).text,
        stderr: keptText(stderr, BANG_SHOWN_MAX).text,
        code: end.code,
        stopped: end.stopped,
        error: end.error,
        sent: blocks.sent,
        total: blocks.total,
      });
      this.flushOutbox();
      // `git checkout` and the like.
      void this.reportBranch();
    });
  }

  /**
   * Claude Code's frames about our `!` entries: written (`completed`), and
   * the end of a turn that took them alone, swallowed (true).
   */
  private ownEnd(message: SDKMessage): boolean {
    const end = entriesEnd(message as unknown as Record<string, unknown>, this.entries);
    for (const uuid of end.written) {
      const id = this.writing.get(uuid);
      this.writing.delete(uuid);
      if (end.swallow || end.taken) this.entries.delete(uuid);
      // Its command's last entry: the page stops counting it.
      if (id && ![...this.writing.values()].includes(id)) {
        this.out({ type: "bash_written", chatId: this.chatId, id });
      }
    }
    return end.swallow;
  }

  /** Esc, or the card's stop: the command and what it started. */
  stopBash(id: string): void {
    void this.bangs.get(id)?.stop();
  }

  /**
   * Hands Claude Code what the user typed, in order, up to a `!` command
   * still running. Its entries going in, the transcript goes on past a
   * /rewind's cut: a wake resumes its end.
   */
  private flushOutbox(): void {
    while (this.outbox.length > 0) {
      const head = this.outbox[0];
      if (head.kind === "bash" && head.entries === null) return;
      this.outbox.shift();
      if (head.kind === "message") {
        this.input.push(head.message);
        head.sent(true);
        continue;
      }
      for (const entry of head.entries ?? []) {
        if (entry.uuid) {
          this.entries.add(entry.uuid);
          this.writing.set(entry.uuid, head.id);
        }
        this.input.push(entry);
      }
      if (head.entries?.length) this.clearCut();
    }
  }

  /** The chat goes on past a /rewind's cut: no more `resumeSessionAt`, the page told. */
  private clearCut(): void {
    if (this.cutBefore === undefined) return;
    this.cutBefore = undefined;
    this.out({ type: "info", chatId: this.chatId, rewind: null });
  }

  /** What is still running or not yet written of the user's `!` commands, or null. */
  bangBusy(): string | null {
    if (this.bangs.size > 0 || this.writing.size > 0) {
      return "Une commande ! tourne : attends sa fin (Échap l'arrête)";
    }
    return null;
  }

  /** Every `!` command still running stopped, its processes gone. */
  stopBangs(): Promise<void> {
    return Promise.all([...this.bangs.values()].map((run) => run.stop())).then(() => {});
  }

  /** Sends an event to the page and keeps it for a later reattach. */
  private out(event: ServerEvent): void {
    if (this.silent) return;
    emit(this.remember(event));
  }

  /** Keeps an event for a later reattach, without sending it. */
  private remember(event: ServerEvent): ServerEvent {
    // Stamped: a page that reloads gets the times things happened.
    const stamped = { ...event, at: Date.now() };
    this.log.push(stamped);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    return stamped;
  }

  /** Replays the chat's life to a page that just (re)opened it. */
  replay(): void {
    emit({ type: "attached", chatId: this.chatId });
    // First: a long chat's log may have lost it, and the cards replayed
    // next need it to tell a command from words (`isCommandSent`).
    if (this.commands) emit({ type: "commands", chatId: this.chatId, commands: this.commands });
    for (const event of this.log) emit(event);
    for (const { latest } of this.workflows.values()) if (latest) emit(latest);
    // The visuals still being checked, page and all: the page checks them.
    for (const page of this.visualPages.values()) emit(page);
    emit({ type: "replayed", chatId: this.chatId });
    this.refreshFigures();
  }

  /**
   * The same life for one phone (`to`): the page shows it already. Not the
   * visuals being checked: the page checks them, the phone only shows them.
   */
  replayTo(to: string): void {
    emit({ type: "attached", chatId: this.chatId }, to);
    if (this.commands) emit({ type: "commands", chatId: this.chatId, commands: this.commands }, to);
    for (const event of this.log) emit(event, to);
    for (const { latest } of this.workflows.values()) if (latest) emit(latest, to);
    emit({ type: "replayed", chatId: this.chatId }, to);
    this.refreshFigures();
  }

  /**
   * The status bar's figures again, for everyone (the same values change
   * nothing for one who has them): a long turn may have pushed them out of
   * the log, and the quotas replayed may date from long ago.
   */
  private refreshFigures(): void {
    this.branch = undefined;
    void this.reportBranch();
    void this.ready
      .then((q) => {
        void this.reportUsage(q);
        void this.reportContext(q);
        // The model menu, effort and MCP states: a long chat or /clear may
        // have dropped them from the log.
        this.effortSent = undefined;
        this.mcpSent = undefined;
        void this.reportModels(q);
        void this.reportEffort(q);
        void this.reportMcp(q);
      })
      .catch(() => {});
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const message of q) {
        // Put to sleep: what that Claude Code still says is no one's.
        if (this.query !== q) break;
        this.touch();
        // The end of a turn Claude Code ran for our `!` entries alone: no one's.
        if (this.ownEnd(message)) continue;
        this.turn = turnAfter(this.turn, message);
        this.tasks = tasksAfter(this.tasks, message);
        this.queued = queuedAfter(this.queued, message);
        // /clear: a reattach replays the new conversation alone. The command
        // list goes first of any replay (`this.commands`): a boot list kept
        // here would come after and override a newer one.
        if (message.type === "conversation_reset") {
          this.log = this.log.filter((e) => e.type === "info");
          // No session until the next message's init names it (its
          // `new_conversation_id` is not it, seen live on 30/10/2026): a
          // relaunch meanwhile starts fresh, never on the cleared one.
          this.sessionId = undefined;
        }
        // A hook's progress shows nothing in the page.
        if (message.type === "system" && message.subtype === "hook_progress") continue;
        if (isEcho(message)) {
          // The user's own is `user_sent`; the others say who opened a turn.
          const origin = echoOrigin(this.chatId, message);
          if (origin) this.out(origin);
          continue;
        }
        this.out({ type: "sdk", chatId: this.chatId, message: slimHook(message) });
        this.watchWorkflows(message);
        this.noteOutputFiles(message);
        // Not in the SDK's types (0.3.314): a message's lifecycle frames.
        const frame = message as { type: string; command_uuid?: unknown };
        if (frame.type === "command_lifecycle" && typeof frame.command_uuid === "string") {
          this.lifecycleWaiters.get(frame.command_uuid)?.();
          this.lifecycleWaiters.delete(frame.command_uuid);
        }
        if (message.type === "system" && message.subtype === "init") {
          this.sessionId = message.session_id;
          this.model = message.model;
          this.mode = message.permissionMode;
        }
        if (message.type === "system" && message.subtype === "status") {
          this.mode = message.permissionMode ?? this.mode;
        }
        if (message.type === "system" && message.subtype === "commands_changed") {
          this.commands = message.commands;
        }
        // A compaction: the last response's usage predates it, the ring
        // must count again at the turn's end (seen 01/11/2026: 95 % shown
        // for 83 k of 1 M).
        if (message.type === "system" && message.subtype === "compact_boundary") {
          this.compacted = true;
        }
        if (message.type === "result") {
          this.clearCut();
          // A finished turn's text lives in its assistant messages: its
          // stream deltas no longer serve a replay.
          this.log = this.log.filter(
            (e) => e.type !== "sdk" || e.message.type !== "stream_event",
          );
          // Nor the turn's hooks that ran well: only failures stay.
          this.log = this.log.filter((e) => e.type !== "sdk" || !isSettledHook(e.message));
          void this.reportContext(q, this.compacted ? "full" : "summary");
          this.compacted = false;
          void this.reportUsage(q);
          void this.reportInfo();
          void this.reportBranch();
          // /model, /effort or a slash command may have changed them.
          void this.reportEffort(q);
          void this.reportMcp(q);
        }
      }
      // Asleep: the chat stays, says nothing (no `closed`, no notification).
      if (this.query === q) this.out({ type: "closed", chatId: this.chatId });
    } catch (e) {
      if (this.query === q) this.out({ type: "closed", chatId: this.chatId, error: String(e) });
    } finally {
      // Stopped for a relaunch: its successor takes the place. Asleep: it stays.
      const asleep = this.query !== q;
      // Its Claude Code gone, by itself or closed: so are its `!` commands.
      if (!asleep) this.finish();
      if (!asleep && !this.silent && chats.get(this.chatId) === this) chats.delete(this.chatId);
    }
  }

  /** The model menu, at boot: Claude Code's own list, with each one's efforts. */
  private async reportModels(q: Query): Promise<void> {
    try {
      const models = await q.supportedModels();
      this.out({ type: "models", chatId: this.chatId, models });
    } catch {
      // The chat closed meanwhile.
    }
  }

  /** The effort the next message runs at (the SDK's `init` leaves it out). */
  private async reportEffort(q: Query): Promise<void> {
    try {
      const settings = await extras(q).getSettings();
      const effort = settings.applied?.effort ?? null;
      if (String(effort) === this.effortSent) return;
      this.effortSent = String(effort);
      this.out({ type: "effort", chatId: this.chatId, effort });
    } catch {
      // The chat closed meanwhile, or a CLI without `get_settings`.
    }
  }

  /**
   * The MCP servers' state, sent when it changes; while some still connect,
   * looked at again every 5 s, `polls` more times.
   */
  private async reportMcp(q: Query, polls = 0): Promise<void> {
    // A new round of looks replaces the one under way; a single look leaves it.
    if (polls > 0) clearTimeout(this.mcpTimer);
    try {
      const all = await q.mcpServerStatus();
      const servers: McpServerInfo[] = all.map((s) => ({
        name: s.name,
        status: s.status,
        error: s.error,
        // Not in the SDK's type, but there (`init.mcp_servers` has it too).
        source: (s as { source?: string }).source,
      }));
      const key = JSON.stringify(servers);
      if (key !== this.mcpSent) {
        this.mcpSent = key;
        this.out({ type: "mcp", chatId: this.chatId, servers });
      }
      if (polls > 0 && !this.silent && all.some((s) => s.status === "pending")) {
        this.mcpTimer = setTimeout(() => void this.reportMcp(q, polls - 1), MCP_POLL_MS);
      }
    } catch {
      // The chat closed meanwhile.
    }
  }

  /**
   * /mcp's buttons. « Se connecter » reconnects first: a claude.ai connector
   * listed « needs-auth » is often signed in already (probe of 01/11/2026:
   * Gmail connected in 0.5 s); still not, it asks for the page to sign in on
   * (`authUrl`, the page opens it) and looks at the server until connected.
   */
  async mcpAction(
    requestId: string,
    server: string,
    action: "connect" | "reconnect" | "enable" | "disable",
  ): Promise<void> {
    const done = (extra: { authUrl?: string; error?: string }) =>
      emit({ type: "mcp_action_done", chatId: this.chatId, requestId, ...extra });
    let q: Query;
    try {
      // Asleep, its Claude Code starts again: the buttons need it.
      q = await this.awake();
    } catch (e) {
      done({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    try {
      if (action === "connect") {
        await q.reconnectMcpServer(server).catch(() => {});
        const now = (await q.mcpServerStatus()).find((s) => s.name === server);
        if (now?.status === "connected") {
          done({});
        } else {
          const auth = await (q as unknown as McpSignIn).mcpAuthenticate(server);
          if (!auth?.authUrl) {
            done({ error: "Claude Code ne donne pas de page de connexion pour ce serveur" });
          } else {
            done({ authUrl: auth.authUrl });
            this.awaitSignIn(q, server, auth.callbackExpected !== false, MCP_SIGNIN_LOOKS);
          }
        }
      } else {
        if (action === "reconnect") await q.reconnectMcpServer(server);
        else await q.toggleMcpServer(server, action === "enable");
        done({});
      }
    } catch (e) {
      done({ error: e instanceof Error ? e.message : String(e) });
    }
    void this.reportMcp(q, MCP_POLLS);
  }

  /**
   * A sign-in opened: the server looked at every 5 s until connected (3 min
   * at most). One with no callback (a claude.ai connector, signed in on
   * claude.ai) is reconnected at each look: nothing else tells it.
   */
  private awaitSignIn(q: Query, server: string, calledBack: boolean, looks: number): void {
    clearTimeout(this.signIns.get(server));
    this.signIns.delete(server);
    if (looks <= 0) return;
    this.signIns.set(
      server,
      setTimeout(async () => {
        // Kept in the map while it looks: the chat stays awake meanwhile.
        try {
          if (!calledBack) await q.reconnectMcpServer(server).catch(() => {});
          const now = (await q.mcpServerStatus()).find((s) => s.name === server);
          await this.reportMcp(q);
          if (!now || now.status === "connected" || now.status === "disabled") {
            this.signIns.delete(server);
            return;
          }
        } catch {
          this.signIns.delete(server);
          return; // The chat closed meanwhile.
        }
        this.awaitSignIn(q, server, calledBack, looks - 1);
      }, MCP_SIGNIN_MS),
    );
  }

  /** The page opened the MCP list: their state now, and while some connect. */
  async refreshMcp(): Promise<void> {
    // Asleep: the list keeps its last states, nothing woken to look.
    if (this.asleep) return;
    await this.reportMcp(await this.ready, MCP_POLLS);
  }

  /**
   * The context by category for the ring's hover: token counts, a second or
   * two. A phone's ask (`to`) is answered to that phone alone.
   */
  async contextDetail(requestId: string, to?: string): Promise<void> {
    // Asleep: the ring keeps its figure; counting would wake Claude Code.
    if (this.asleep) {
      emit({ type: "context_detail", chatId: this.chatId, requestId, error: "Claude en veille : détail indisponible" }, to);
      return;
    }
    try {
      const u = await (await this.ready).getContextUsage({ detail: "full" });
      // Counted afresh: the ring takes it too, never left behind the detail.
      this.out({
        type: "context",
        chatId: this.chatId,
        percentage: u.percentage,
        totalTokens: u.totalTokens,
        maxTokens: u.rawMaxTokens,
        model: u.model,
      });
      emit(
        {
          type: "context_detail",
          chatId: this.chatId,
          requestId,
          detail: {
            categories: u.categories.map(({ id, name, tokens, kind }) => ({ id, name, tokens, kind })),
            totalTokens: u.totalTokens,
            rawMaxTokens: u.rawMaxTokens,
            memoryFiles: u.memoryFiles.map(({ path, tokens }) => ({ path, tokens })),
          },
        },
        to,
      );
    } catch (e) {
      emit({ type: "context_detail", chatId: this.chatId, requestId, error: String(e) }, to);
    }
  }

  /** The effort for this session alone: `applyFlagSettings`, never a settings file. */
  async setEffort(effort: EffortLevel): Promise<void> {
    this.effort = effort;
    const q = await this.awake();
    await q.applyFlagSettings({ effortLevel: effort });
    await this.reportEffort(q);
  }

  /**
   * Withdraws a queued message: Claude Code drops it (a `cancelled` lifecycle
   * frame) only while still queued. Too late, it was taken: it stays so.
   */
  async cancelQueued(uuid: string): Promise<void> {
    // Still held here behind a `!` command: Claude Code never had it.
    const held = this.outbox.findIndex((o) => o.kind === "message" && o.uuid === uuid);
    if (held >= 0) {
      const [message] = this.outbox.splice(held, 1);
      if (message.kind === "message") message.sent(false);
      this.queued = this.queued.filter((u) => u !== uuid);
      this.out({ type: "queued_removed", chatId: this.chatId, uuid });
      return;
    }
    const cancelled = await extras(await this.ready).cancelAsyncMessage(uuid);
    if (cancelled) this.out({ type: "queued_removed", chatId: this.chatId, uuid });
    else emit({ type: "error", chatId: this.chatId, message: "Trop tard : Claude a déjà pris ce message" });
  }

  /** « Recharger » under plugins that failed: plugins and skills read again. */
  async reloadPlugins(): Promise<void> {
    const q = await this.awake();
    const reloaded = await q.reloadPlugins();
    await q.reloadSkills().catch(() => {});
    this.commands = reloaded.commands;
    this.out({ type: "commands", chatId: this.chatId, commands: reloaded.commands });
    void this.reportMcp(q, MCP_POLLS);
    const n = reloaded.error_count;
    this.out({
      type: "notice",
      chatId: this.chatId,
      text:
        n === 0
          ? "Plugins rechargés"
          : `Plugins rechargés : ${n} toujours en erreur`,
      tone: n === 0 ? "info" : "error",
    });
  }

  /**
   * Hands a visual to the page, which renders it offscreen (any tab, shown
   * or not) and reports what broke; null after `VISUAL_CHECK_MS`. The page
   * goes live only: the log keeps the check without it (a page can weigh
   * tens of Mo with its images, and the log lives as long as the chat). A
   * page reloaded meanwhile gets it again while its check is open
   * (`visualPages`), and asks for a kept copy later (`visual_html`).
   */
  private checkVisual(visual: PreparedVisual): Promise<VisualReport | null> {
    const checkId = visual.toolUseId ?? randomUUID();
    return new Promise((resolve) => {
      const done = (report: VisualReport | null) => {
        if (!this.visualChecks.delete(checkId)) return;
        this.visualPages.delete(checkId);
        clearTimeout(timer);
        this.out({ type: "visual_checked", chatId: this.chatId, checkId });
        resolve(report);
      };
      const timer = setTimeout(() => done(null), VISUAL_CHECK_MS);
      this.visualChecks.set(checkId, done);
      if (this.silent) return;
      const check = { type: "visual_check" as const, chatId: this.chatId, checkId, account: ACCOUNT, ...visual };
      const stub = this.remember({ ...check, html: null });
      const page = { ...stub, html: visual.html };
      this.visualPages.set(checkId, page);
      emit(page);
    });
  }

  /** The page's report on a visual; the first one counts. */
  reportVisual(checkId: string, report: unknown): void {
    const read = readVisualReport(report);
    if (read) this.visualChecks.get(checkId)?.(read);
  }

  /** An MCP server's request waits here for the page's answer. */
  private askElicitation(
    request: ElicitationRequest,
    { requestId, signal }: Parameters<OnElicitation>[1],
  ): Promise<ElicitationResult> {
    return new Promise((resolve) => {
      this.elicitations.set(requestId, resolve);
      signal.addEventListener("abort", () => {
        if (!this.elicitations.delete(requestId)) return;
        this.out({ type: "elicitation_resolved", chatId: this.chatId, requestId });
        resolve({ action: "cancel" });
      });
      this.out({ type: "elicitation", chatId: this.chatId, requestId, request });
    });
  }

  answerElicitation(requestId: string, result: ElicitationResult): void {
    const resolve = this.elicitations.get(requestId);
    if (!resolve) return;
    this.elicitations.delete(requestId);
    this.out({ type: "elicitation_resolved", chatId: this.chatId, requestId });
    resolve(result);
  }

  /**
   * 'summary': from the last response's usage, without token-count calls;
   * 'full' counts again (after a compaction, the last response is older).
   */
  private async reportContext(
    q: Query,
    detail: "summary" | "full" = "summary",
  ): Promise<void> {
    try {
      const usage = await q.getContextUsage({ detail });
      this.model = usage.model;
      this.out({
        type: "context",
        chatId: this.chatId,
        percentage: usage.percentage,
        totalTokens: usage.totalTokens,
        maxTokens: usage.rawMaxTokens,
        model: usage.model,
      });
    } catch {
      // The chat closed meanwhile.
    }
  }

  /** The account's 5-hour and weekly windows, as the terminal's `/usage`. */
  private async reportUsage(q: Query): Promise<void> {
    try {
      // Experimental in the SDK: a CLI that lacks it fails here, harmlessly.
      const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: true,
      });
      this.out({ type: "usage", chatId: this.chatId, rateLimits: usage.rate_limits });
    } catch {
      // The chat closed meanwhile, or the usage endpoint failed.
    }
  }

  /** Only the title: the transcript's branch is the one of its last message. */
  private async reportInfo(): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    try {
      const info = await getSessionInfo(sessionId, { dir: this.cwd });
      // A /clear meanwhile: that session is no longer this chat's.
      if (!info || sessionId !== this.sessionId) return;
      // A session opened by a command (/clear) is no title yet.
      const summary = info.summary.startsWith("/") ? undefined : info.summary;
      this.out({
        type: "info",
        chatId: this.chatId,
        title: info.customTitle ?? summary,
        sessionId,
      });
    } catch {
      // No transcript yet.
    }
  }

  /** The live branch, sent only when it changes; a failed look keeps it. */
  private async reportBranch(): Promise<void> {
    if (this.branchLooking) return;
    this.branchLooking = true;
    try {
      const branch = await gitBranch(this.cwd);
      if (branch === undefined || branch === this.branch) return;
      this.branch = branch;
      this.out({ type: "info", chatId: this.chatId, gitBranch: branch });
    } finally {
      this.branchLooking = false;
    }
  }

  /** The `/` menu's list, before any turn; `commands_changed` updates it. */
  private async reportCommands(q: Query): Promise<void> {
    try {
      const commands = await q.supportedCommands();
      // A `commands_changed` that came meanwhile is newer.
      this.commands ??= commands;
      this.out({ type: "commands", chatId: this.chatId, commands: this.commands });
    } catch {
      // The chat closed meanwhile.
    }
  }

  /** Every tool Claude Code asks about waits here for the page's answer. */
  private askPage(
    toolName: string,
    input: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    const { requestId, signal } = options;
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      signal.addEventListener("abort", () => {
        if (!this.pending.delete(requestId)) return;
        this.out({ type: "permission_resolved", chatId: this.chatId, requestId });
        resolve({ behavior: "deny", message: "Cancelled" });
      });
      this.out({
        type: "permission",
        chatId: this.chatId,
        requestId,
        toolName,
        input,
        toolUseId: options.toolUseID,
        title: options.title,
        description: options.description,
        decisionReason: options.decisionReason,
        suggestions: options.suggestions,
        displayName: options.displayName,
        defaultToNo: options.defaultToNo,
        suppressAlwaysAllowRule: options.suppressAlwaysAllowRule,
        agentId: options.agentID,
        blockedPath: options.blockedPath,
        mcpServer: options.mcpServer,
      });
    });
  }

  answer(requestId: string, result: PermissionResult): void {
    const resolve = this.pending.get(requestId);
    if (!resolve) return;
    this.pending.delete(requestId);
    this.out({ type: "permission_resolved", chatId: this.chatId, requestId });
    resolve(result);
  }

  /**
   * The SDK hands every message to Claude Code at once, which queues it while
   * a turn runs: its `command_lifecycle` frames, named by our uuid, say when
   * it is taken (« started »). Priority `now` ends the turn under way first.
   */
  async send(
    text: string,
    images: ImageInput[] = [],
    priority?: "now",
    spare: string[] = [],
    pastes: string[] = [],
  ): Promise<void> {
    // Asleep: Claude Code starts again, the message waits in its input.
    this.wake();
    const uuid = randomUUID();
    // Not taken yet: its lifecycle frames, then the turn's replies, say when.
    this.queued = [...this.queued, uuid];
    this.out({
      type: "user_sent",
      chatId: this.chatId,
      text,
      images: images.length,
      pasted: images,
      // Display only: Claude gets `text`, the pastes in it.
      ...(pastes.length > 0 ? { pastes } : {}),
      uuid,
    });
    const message: SDKUserMessage = {
      type: "user",
      uuid,
      ...(priority ? { priority } : {}),
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          // Each image named first (« [Image #2] »), as its tag names it
          // in the text where the user pasted it: Claude knows which is which.
          ...images.flatMap((img) => [
            ...(img.label
              ? [{ type: "text" as const, text: `[${img.label}]` }]
              : []),
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mediaType as "image/png",
                data: img.data,
              },
            },
          ]),
          { type: "text" as const, text },
        ],
      },
    };
    // A `!` command typed before it still running: its output goes to
    // Claude with this message, as in the terminal, so it waits in order
    // (withdrawn meanwhile by its ×: never sent).
    const pushed = await new Promise<boolean>((sent) => {
      this.outbox.push({ kind: "message", uuid, message, sent });
      this.flushOutbox();
    });
    if (!pushed || spare.length === 0) return;
    // Sent now while foreground agents run: a `now` would end them with the
    // turn. Queued once Claude Code has it, their backgrounding hands the
    // Agent calls a result, and Claude takes it at that boundary. Its frames
    // come on Claude Code's output, after this: the wait is set in time.
    await this.lifecycleSeen(uuid);
    const q = await this.ready;
    // Nothing sent away: no boundary takes it, so the turn stops for it (a
    // message waiting outlives an interrupt and runs next).
    if (!(await this.spare(q, spare))) await q.interrupt();
  }

  /** Resolves at the message's first lifecycle frame, or after 2 s (older CLI). */
  private lifecycleSeen(uuid: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.lifecycleWaiters.delete(uuid);
        resolve();
      }, LIFECYCLE_WAIT_MS);
      this.lifecycleWaiters.set(uuid, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Esc stops Claude's turn, never a subagent: a foreground Agent call dies
   * with the turn (verified live 31/10/2026), so the page's running ones go
   * to the background first; background ones and workflows outlive it
   * (`perTaskStopAffordance`). A message waiting is never cut this way: the
   * page then sends `background` alone (`stopTurnPlan`).
   */
  async interrupt(spare: string[] = []): Promise<void> {
    // Asleep: no turn to stop.
    if (this.asleep) return;
    const q = await this.ready;
    for (const toolUseId of spare) await q.backgroundTasks(toolUseId).catch(() => false);
    await q.interrupt();
  }

  /** Ctrl+B: every foreground Bash command and subagent, as in the terminal. */
  async background(toolUseIds?: string[]): Promise<void> {
    if (this.asleep) return;
    const q = await this.ready;
    if (!toolUseIds?.length) {
      await q.backgroundTasks();
      return;
    }
    // A message waits: the Agent calls' results let Claude take it, no
    // interrupt. Nothing sent away (a stale row, a turn on a Bash): no
    // boundary takes it, so the turn stops as a plain Esc.
    if (!(await this.spare(q, toolUseIds))) await q.interrupt();
  }

  /** Each Agent call to the background; true if any went. */
  private async spare(q: Query, toolUseIds: string[]): Promise<boolean> {
    let any = false;
    for (const toolUseId of toolUseIds) {
      if (await q.backgroundTasks(toolUseId).catch(() => false)) any = true;
    }
    return any;
  }

  async stopTask(taskId: string): Promise<void> {
    // Asleep: no task runs (one running keeps it awake).
    if (this.asleep) return;
    await (await this.ready).stopTask(taskId);
  }

  /**
   * Where each background shell writes: its Bash call's result names the
   * file, and its end (`task_notification`) too.
   */
  private noteOutputFiles(message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "task_notification") {
      if (message.output_file) this.outputFiles.set(message.task_id, message.output_file);
      return;
    }
    if (message.type !== "user" || !Array.isArray(message.message.content)) return;
    for (const block of message.message.content) {
      if (block.type !== "tool_result") continue;
      const content = block.content;
      const text =
        typeof content === "string"
          ? content
          : (content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
      for (const [taskId, path] of outputFiles(text)) this.outputFiles.set(taskId, path);
    }
  }

  /**
   * The last 8 KiB a background shell wrote, for the shells list (polled).
   * Claude Code decodes it as UTF-8: an output in the console's code page
   * (Windows' own programs) is read again from its file (`readConsoleTail`).
   */
  async taskOutput(taskId: string, to?: string): Promise<void> {
    if (this.asleep) {
      emit({ type: "task_output", chatId: this.chatId, taskId, output: "", truncated: false, error: "Claude est en veille" }, to);
      return;
    }
    const q = (await this.ready) as Query & {
      // In sdk.mjs, not yet in its types (0.3.314): `get_task_output`.
      getTaskOutput(id: string): Promise<{ output: string; truncated: boolean }>;
    };
    const chatId = this.chatId;
    try {
      let { output, truncated } = await q.getTaskOutput(taskId);
      const file = this.outputFiles.get(taskId);
      if (file && needsReread(output, truncated)) {
        const again = await readConsoleTail(file);
        if (again) ({ output, truncated } = again);
      }
      emit({ type: "task_output", chatId, taskId, output, truncated }, to);
    } catch (e) {
      emit({ type: "task_output", chatId, taskId, output: "", truncated: false, error: String(e) }, to);
    }
  }

  /**
   * A workflow launched (its tool result names its folder) is watched until
   * its notification. What the watcher sees goes out unlogged, the latest
   * kept for a replay: it changes every second while agents work.
   */
  private watchWorkflows(message: SDKMessage): void {
    if (message.type === "user" && !message.parent_tool_use_id) {
      const r = message.tool_use_result as
        | { taskType?: unknown; taskId?: unknown; transcriptDir?: unknown }
        | undefined;
      const { taskId, transcriptDir } = r ?? {};
      if (
        r?.taskType !== "local_workflow" ||
        typeof taskId !== "string" ||
        typeof transcriptDir !== "string" ||
        this.workflows.has(taskId)
      )
        return;
      const entry: { watch: WorkflowWatch; latest?: ServerEvent } = {
        watch: new WorkflowWatch(transcriptDir, (agents) => {
          if (this.silent) return;
          const event = { type: "workflow_live" as const, chatId: this.chatId, taskId, agents };
          // Stamped as `out` does: the page's clocks read `at`.
          const stamped = { ...event, at: Date.now() };
          entry.latest = stamped;
          emit(stamped);
        }),
      };
      this.workflows.set(taskId, entry);
    } else if (message.type === "system" && message.subtype === "task_notification") {
      this.workflows.get(message.task_id)?.watch.stop();
      this.workflows.delete(message.task_id);
    }
  }

  async setMode(mode: PermissionMode): Promise<void> {
    this.mode = mode;
    await (await this.awake()).setPermissionMode(mode);
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    const q = await this.awake();
    await q.setModel(model);
    // Another model may take other efforts, or none.
    void this.reportEffort(q);
  }

  /** /resume: the folder's sessions; one open in another chat can't be taken. */
  async sessions(): Promise<Extract<ServerEvent, { type: "sessions" }>["sessions"]> {
    const open = new Set(
      [...chats.values()].filter((c) => c !== this).map((c) => c.sessionId),
    );
    const list = await listSessions({ dir: this.cwd, limit: SESSIONS_LIMIT });
    return list.map((s) => ({
      sessionId: s.sessionId,
      title: s.customTitle ?? s.summary,
      lastModified: s.lastModified,
      gitBranch: s.gitBranch,
      open: open.has(s.sessionId) || undefined,
    }));
  }

  /** /rewind: what the user wrote in the conversation, oldest first. */
  async rewindPoints(): Promise<Extract<ServerEvent, { type: "rewind_points" }>["points"]> {
    if (!this.sessionId) return [];
    const all = await getSessionMessages(this.sessionId, { dir: this.cwd });
    // Rewound and nothing sent yet: the transcript still holds what went.
    const cut = all.findIndex((m) => m.uuid === this.cutBefore);
    return (cut >= 0 ? all.slice(0, cut) : all).flatMap((m) => {
      const text = m.type === "user" && typedByUser(m) ? promptText(m.message) : null;
      // Not in the SDK's type, but there: the transcript entry's time.
      const { timestamp } = m as { timestamp?: string };
      return text ? [{ uuid: m.uuid, text, timestamp }] : [];
    });
  }

  /**
   * The start of a relaunch: another session, or this one cut just before a
   * message of the user, as the terminal's Esc Esc does (same session, the
   * next message branches off). Files go back first when asked: their
   * backups belong to this Claude Code.
   */
  async relaunchStart(cmd: Extract<Command, { type: "relaunch" }>): Promise<Boot> {
    // A `!` command would die with this Claude Code, its output never Claude's.
    const busy = this.bangBusy();
    if (busy) throw new Error(busy);
    const base: Boot = {
      ...this.start,
      resume: undefined,
      continue: undefined,
      resumeSessionAt: undefined,
      historyBefore: undefined,
      // A new column, awake: what a restart after the server stopped asked is past.
      keep: undefined,
      cut: undefined,
      asleep: undefined,
      notice: undefined,
      permissionMode: this.mode,
      model: this.model,
      effort: this.effort,
    };
    if (cmd.resume) {
      // Already this chat's: a second relaunch (double choice) would stop the
      // Claude Code the first one just started.
      if (cmd.resume === this.sessionId) throw new Error("Cette conversation est déjà ouverte ici");
      // Never two Claude Code on one session (the page checks its panes).
      const held = [...chats.values()].some((c) => c !== this && c.sessionId === cmd.resume);
      if (held) throw new Error("Cette conversation est ouverte dans un autre volet");
      return { ...base, resume: cmd.resume };
    }
    if (!cmd.rewind || !this.sessionId) throw new Error("Rien à reprendre");
    const { before, code } = cmd.rewind;
    const all = await getSessionMessages(this.sessionId, {
      dir: this.cwd,
      includeSystemMessages: true,
    });
    const at = all.findIndex((m) => m.uuid === before);
    if (at < 0) throw new Error("Message introuvable dans la conversation");
    const notice = code ? await this.restoreFiles(before) : undefined;
    // The entry just before the message (its parent); none for the first.
    const fork = all[at - 1]?.uuid;
    return fork
      ? { ...base, resume: this.sessionId, resumeSessionAt: fork, historyBefore: before, notice }
      : { ...base, notice };
  }

  /**
   * The files as they were just before a message of the user (the backups
   * `enableFileCheckpointing` keeps): what to say, or an error, nothing
   * touched. Counted by a dry run, the real one doesn't say.
   */
  private async restoreFiles(before: string): Promise<string> {
    // The backups belong to Claude Code: an asleep chat wakes to read them.
    const q = await this.awake();
    const preview = await q.rewindFiles(before, { dryRun: true });
    const files = preview.canRewind ? await q.rewindFiles(before) : preview;
    if (!files.canRewind) {
      throw new Error(`Code non restauré : ${files.error ?? "aucune sauvegarde"}`);
    }
    const n = preview.filesChanged?.length ?? 0;
    return n === 0
      ? "Code déjà comme avant ce message"
      : `Code remis comme avant ce message : ${n} fichier${n > 1 ? "s" : ""}`;
  }

  /**
   * The messages just before `before` (the oldest the page shows), straight
   * to the page: not logged, a reloaded page starts from the latest again.
   * The SDK reads a session from its last compaction on (verified live on
   * 31/10/2026, `includeSystemMessages` too): a page shown from before a
   * compaction has nothing older to reach, and says so (`unreachable`).
   */
  async older(before: string, limit: number, to?: string): Promise<void> {
    if (!this.sessionId) throw new Error("Pas encore de conversation à remonter");
    const all = await getSessionMessages(this.sessionId, { dir: this.cwd });
    const at = all.findIndex((m) => m.uuid === before);
    if (at < 0) {
      emit(
        {
          type: "history",
          chatId: this.chatId,
          messages: [],
          truncated: false,
          older: true,
          unreachable: true,
        },
        to,
      );
      return;
    }
    const from = Math.max(0, at - Math.min(limit, HISTORY_LIMIT));
    emit(
      {
        type: "history",
        chatId: this.chatId,
        messages: all.slice(from, at),
        truncated: from > 0,
        older: true,
      },
      to,
    );
  }

  /** /rewind's « code seul »: the files go back, the conversation stays. */
  async restoreCode(before: string): Promise<void> {
    const text = await this.restoreFiles(before);
    this.out({ type: "notice", chatId: this.chatId, text, tone: "info" });
  }

  /** Ends its Claude Code without a word to the page, for a relaunch. */
  async stop(): Promise<void> {
    this.silent = true;
    this.close();
    await this.ready.then(
      () => this.pumping,
      () => {},
    );
  }

  /** Closes it without a word to the page: the server leaves (`shutdown`). */
  leave(): void {
    this.silent = true;
    this.close();
  }

  /** Resolves once its `!` commands' processes are killed (`close`). */
  stopped: Promise<void> = Promise.resolve();

  close(): void {
    this.finish();
    for (const { watch } of this.workflows.values()) watch.stop();
    this.workflows.clear();
    for (const resolve of this.pending.values()) {
      resolve({ behavior: "deny", message: "Chat closed" });
    }
    this.pending.clear();
    for (const resolve of this.elicitations.values()) resolve({ action: "cancel" });
    this.elicitations.clear();
    for (const done of [...this.visualChecks.values()]) done(null);
    this.visualPages.clear();
    clearTimeout(this.mcpTimer);
    for (const timer of this.signIns.values()) clearTimeout(timer);
    this.signIns.clear();
    this.input.end();
    this.query?.close();
    // Still booting: close the query as soon as it exists.
    void this.ready.then((q) => q.close()).catch(() => {});
  }
}

const chats = new Map<string, Chat>();

/**
 * The CLI's echo of a user message (`--replay-user-messages`) that the page
 * has already: the user's own (`user_sent`, images and all). Only another
 * session's or a subagent's message (`origin.kind: 'peer'`) goes on.
 */
function isEcho(message: SDKMessage): boolean {
  if (message.type !== "user" || !("isReplay" in message) || !message.isReplay) return false;
  return message.origin?.kind !== "peer";
}

/**
 * What an echo the page doesn't get was, the user's own aside: a task's
 * report, an artifact comment, a wakeup… Only its kind and two marks, as the
 * notification hook reads them (`Test-TurnSelfWoken`), never its text.
 */
function echoOrigin(chatId: string, message: SDKMessage): ServerEvent | null {
  if (message.type !== "user") return null;
  const kind = message.origin?.kind ?? null;
  if (kind === "human") return null;
  const text = JSON.stringify(message.message?.content ?? "");
  // A `!` command's entries (`Chat.bash`): the user's, and no turn opens on them.
  if (text.startsWith('"<bash-')) return null;
  return {
    type: "user_origin",
    chatId,
    kind,
    artifact: text.includes("<task-type>artifact-"),
    idleNotice: text.includes("[Cross-session idle notice]"),
  };
}

/** A hook that went well says nothing the page shows: its output stays here. */
function slimHook(message: SDKMessage): SDKMessage {
  if (message.type !== "system" || message.subtype !== "hook_response") return message;
  if (message.outcome === "error") return message;
  return { ...message, output: "", stdout: "", stderr: "" };
}

/** A hook of a finished turn that ran well: a replay doesn't need it. */
function isSettledHook(message: SDKMessage): boolean {
  if (message.type !== "system") return false;
  if (message.subtype === "hook_started") return true;
  return message.subtype === "hook_response" && message.outcome !== "error";
}

async function history(cmd: Extract<Command, { type: "history" }>) {
  const all = cmd.agentId
    ? await getSubagentMessages(cmd.sessionId, cmd.agentId, { dir: cmd.cwd })
    : await getSessionMessages(cmd.sessionId, { dir: cmd.cwd });
  const messages = all.slice(-cmd.limit);
  emit(
    {
      type: "history",
      chatId: cmd.chatId,
      agentId: cmd.agentId,
      messages,
      truncated: all.length > messages.length,
    },
    cmd.to,
  );
}

/** How many of the folder's sessions /resume lists. */
const SESSIONS_LIMIT = 60;

/** A past visual's page with its images in, if one was kept (`visual.ts`). */
async function visualHtml(cmd: Extract<Command, { type: "visual_html" }>): Promise<void> {
  const html = await storedVisual(cmd.toolUseId);
  emit({ type: "visual_html", chatId: cmd.chatId, toolUseId: cmd.toolUseId, html }, cmd.to);
}

/**
 * « Ouvrir dans le navigateur »: the page in a file of the temp folder, opened
 * by Windows' default handler (the browser). Named by its title and content:
 * opened twice, the same file.
 */
async function openVisual(cmd: Extract<Command, { type: "visual_open" }>): Promise<void> {
  const dir = join(tmpdir(), "arkadia-visuals");
  await mkdir(dir, { recursive: true });
  const slug =
    cmd.title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "visuel";
  const hash = createHash("sha256").update(cmd.html).digest("hex").slice(0, 8);
  const file = join(dir, `${slug}-${hash}.html`);
  await writeFile(file, cmd.html, "utf8");
  // Explorer exits 1 even when it opened the file: its code says nothing.
  execFile("explorer.exe", [file], { windowsHide: true }, () => {});
}

/** How Claude Code opens the summary that replaces a compacted conversation. */
const COMPACT_SUMMARY = "This session is being continued from a previous conversation";

/**
 * Not Claude Code's own (`is_meta`), nor another session's or a subagent's
 * (`origin`): both live in the transcript as user messages. Neither field is
 * in the SDK's type, but there (verified on 31/10/2026).
 */
function typedByUser(m: unknown): boolean {
  const { is_meta, origin } = m as { is_meta?: unknown; origin?: { kind?: unknown } };
  if (is_meta === true) return false;
  return origin?.kind === undefined || origin.kind === "human";
}

/** A message the user typed, or null: tool results, commands' output, notes. */
function promptText(message: unknown): string | null {
  const content = (message as { content?: unknown } | null)?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    const blocks = content as { type?: string; text?: string }[];
    if (blocks.some((b) => b?.type === "tool_result")) return null;
    text = blocks
      // An image's label (« [Image #2] ») is no line of the prompt.
      .filter((b) => b?.type === "text" && !/^\[Image #\d+\]$/.test(b.text ?? ""))
      .map((b) => b.text ?? "")
      .join("\n");
  }
  text = text.trim();
  if (
    !text ||
    text.startsWith("<") ||
    text.startsWith(COMPACT_SUMMARY) ||
    text.startsWith("[Request interrupted") ||
    text.startsWith("Caveat:")
  )
    return null;
  return text;
}

/**
 * /resume and /rewind: the chat's Claude Code ends, then another starts in
 * its place (never two on one session); the page starts its column over.
 */
async function relaunch(chat: Chat, cmd: Extract<Command, { type: "relaunch" }>) {
  let next: Boot;
  try {
    next = await chat.relaunchStart(cmd);
  } catch (e) {
    // Nothing changed: the chat goes on as it was.
    emit({ type: "error", chatId: cmd.chatId, message: e instanceof Error ? e.message : String(e) });
    return;
  }
  await chat.stop();
  // Closed meanwhile: nothing to start again.
  if (chats.get(cmd.chatId) !== chat) return;
  emit({ type: "attached", chatId: cmd.chatId });
  emit({ type: "replayed", chatId: cmd.chatId });
  chats.set(cmd.chatId, new Chat(cmd.chatId, next));
}

/** A list the page asked for: its answer, or the error in its place. */
async function answerList(
  cmd: Extract<Command, { type: "sessions" | "rewind_points" }>,
  chat: Chat,
): Promise<void> {
  const { chatId, requestId } = cmd;
  try {
    if (cmd.type === "sessions") {
      emit({ type: "sessions", chatId, requestId, sessions: await chat.sessions() });
    } else {
      emit({ type: "rewind_points", chatId, requestId, points: await chat.rewindPoints() });
    }
  } catch (e) {
    const error = String(e);
    if (cmd.type === "sessions") emit({ type: "sessions", chatId, requestId, sessions: [], error });
    else emit({ type: "rewind_points", chatId, requestId, points: [], error });
  }
}

/** Relaunches under way (/resume, /rewind): the chat's next commands wait. */
const relaunching = new Map<string, Promise<void>>();

/**
 * What the user does in a chat: its sleep waits from then. Looking at it
 * (branch, context's hover, MCP list, shells' output, a page's report) is
 * not: the tab on screen may sleep too.
 */
const ACTIVE_COMMANDS = new Set<Command["type"]>([
  "send",
  "mcp_action",
  "interrupt",
  "answer",
  "set_mode",
  "set_model",
  "set_effort",
  "background",
  "stop_task",
  "cancel_queued",
  "elicit_answer",
  "reload_plugins",
  "restore_code",
  "wake",
  "bash",
  "bash_stop",
]);

async function handle(cmd: Command): Promise<void> {
  // Awaited only when there is one: a relaunch registers itself before any
  // command read after it runs.
  const pending = relaunching.get(cmd.chatId);
  if (pending) await pending.catch(() => {});
  if (cmd.type === "start") {
    const after = readSleepAfter(cmd.sleepAfterMs);
    if (after !== undefined) sleepAfterMs = after;
    // A page that reloads starts its chats again: they keep running.
    const running = chats.get(cmd.chatId);
    if (running) return running.replay();
    chats.set(cmd.chatId, new Chat(cmd.chatId, cmd));
    return;
  }
  if (cmd.type === "history") return history(cmd);
  if (cmd.type === "phone_replay") {
    const running = chats.get(cmd.chatId);
    if (running) return running.replayTo(cmd.to);
    // Not running: the phone shows it ended, with « Reprendre ».
    emit({ type: "closed", chatId: cmd.chatId }, cmd.to);
    return;
  }
  if (cmd.type === "sleep_after") {
    const after = readSleepAfter(cmd.ms);
    if (after !== undefined) sleepAfterMs = after;
    return;
  }
  // Sent whenever a pane shows: one not started yet (or gone) has no branch to look at.
  if (cmd.type === "refresh_branch") return chats.get(cmd.chatId)?.refreshBranch();
  // A closed chat's past visuals show too: no live chat needed.
  if (cmd.type === "visual_html") return visualHtml(cmd);
  if (cmd.type === "visual_open") return openVisual(cmd);
  // A report for a chat gone meanwhile (closed, relaunched) has no one to tell.
  if (cmd.type === "visual_report") return chats.get(cmd.chatId)?.reportVisual(cmd.checkId, cmd.report);
  if (cmd.type === "agent_history") {
    // An agent's sheet with no agent: an error, never the session's past.
    if (typeof cmd.agentId !== "string" || !cmd.agentId) {
      emit({ type: "error", chatId: cmd.chatId, message: "Sous-agent inconnu" }, replyTo(cmd));
      return;
    }
    return history({ ...cmd, type: "history" });
  }
  const chat = chats.get(cmd.chatId);
  // Arkadia closes the chat of every pane it closes, chat or not.
  if (!chat && cmd.type === "close") return;
  if (!chat) {
    emit({ type: "error", chatId: cmd.chatId, message: "Conversation fermée" }, replyTo(cmd));
    return;
  }
  if (ACTIVE_COMMANDS.has(cmd.type)) chat.touch();
  switch (cmd.type) {
    case "send":
      return chat.send(cmd.text, cmd.images, cmd.priority, cmd.spare, cmd.pastes);
    case "interrupt":
      await chat.interrupt(cmd.spare);
      return;
    case "answer":
      return chat.answer(cmd.requestId, cmd.result);
    case "set_mode":
      return chat.setMode(cmd.mode);
    case "set_model":
      return chat.setModel(cmd.model);
    case "sessions":
    case "rewind_points":
      return answerList(cmd, chat);
    case "relaunch": {
      const run = relaunch(chat, cmd).finally(() => relaunching.delete(cmd.chatId));
      relaunching.set(cmd.chatId, run);
      return run;
    }
    case "older":
      return chat.older(cmd.before, cmd.limit, cmd.to).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        emit({ type: "error", chatId: cmd.chatId, message }, cmd.to);
      });
    case "background":
      return chat.background(cmd.toolUseIds);
    case "stop_task":
      return chat.stopTask(cmd.taskId);
    case "task_output":
      return chat.taskOutput(cmd.taskId, cmd.to);
    case "restore_code":
      return chat.restoreCode(cmd.before).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        emit({ type: "error", chatId: cmd.chatId, message });
      });
    case "set_effort":
      return chat.setEffort(cmd.effort);
    case "cancel_queued":
      return chat.cancelQueued(cmd.uuid);
    case "elicit_answer":
      return chat.answerElicitation(cmd.requestId, cmd.result);
    case "context_detail":
      return chat.contextDetail(cmd.requestId, cmd.to);
    case "mcp_status":
      return chat.refreshMcp();
    case "mcp_action":
      return chat.mcpAction(cmd.requestId, cmd.server, cmd.action);
    case "reload_plugins":
      return chat.reloadPlugins();
    case "wake":
      return chat.wake();
    case "bash":
      return chat.bash(cmd.id, cmd.command);
    case "bash_stop":
      return chat.stopBash(cmd.id);
    case "sleep":
      chat.sleepIfDue(Date.now(), 0);
      return;
    case "close":
      chats.delete(cmd.chatId);
      return chat.close();
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let cmd: Command;
  try {
    cmd = JSON.parse(line) as Command;
  } catch {
    emit({ type: "error", message: `Commande illisible : ${line.slice(0, 200)}` });
    return;
  }
  handle(cmd).catch((e: unknown) =>
    emit(
      { type: "error", chatId: "chatId" in cmd ? cmd.chatId : undefined, message: String(e) },
      replyTo(cmd),
    ),
  );
});
// Arkadia closed our stdin: it is gone, so are the chats.
lines.on("close", () => shutdown(0));

/** What the chats' Claude Code get to leave on their own, their input ended. */
const SHUTDOWN_GRACE_MS = 3_000;
let leaving = false;

/**
 * Every way out of the server (Arkadia gone, its pipes closed, too many
 * errors): each chat closes, its `!` commands' processes killed and its
 * Claude Code's input ended, so it leaves on its own. A moment later what is
 * still under the server is killed with it: the page resumes these chats in
 * the next server, never two Claude Code on one session, and no `!`
 * command outlives it.
 */
function shutdown(code: number): void {
  if (leaving) return;
  leaving = true;
  const all = [...chats.values()];
  // Without a word: a `closed` would keep the page from resuming them.
  for (const chat of all) chat.leave();
  const killed = Promise.all(all.map((chat) => chat.stopped));
  const grace = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
  void Promise.all([killed, grace]).then(() => {
    try {
      // Its whole tree, itself included: what is left of it goes too.
      execFileSync("taskkill", ["/F", "/T", "/PID", String(process.pid)], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // Nothing left to kill but itself, or taskkill missing.
    }
    process.exit(code);
  });
}

// Chats nothing ran in for the Lab's delay put their Claude Code to sleep.
setInterval(() => {
  const now = Date.now();
  for (const [chatId, chat] of chats) {
    if (!relaunching.has(chatId)) chat.sleepIfDue(now, sleepAfterMs);
  }
}, SLEEP_CHECK_MS).unref();

/**
 * An error no chat caught ends nothing: every command's own error goes to
 * its chat (`handle`), a chat's Claude Code that breaks ends that chat
 * (`pump`), and what is left lands here. Only a pile of them in a minute
 * (`strayVerdict`) ends the server: Arkadia starts another on the next
 * command, and the page resumes each chat on its session (`chatLive`).
 */
let strays: number[] = [];
function onStray(kind: string, error: unknown): void {
  // Arkadia is gone: nobody to write to.
  if (pipeGone(error)) return shutdown(0);
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[guard] ${kind}: ${text}\n`);
  const verdict = strayVerdict(strays, Date.now());
  strays = verdict.times;
  // Already leaving: said once.
  if (!verdict.exit || leaving) return;
  process.stderr.write("[guard] too many errors in a minute: the server exits\n");
  shutdown(1);
}
process.on("uncaughtException", (e) => onStray("uncaughtException", e));
process.on("unhandledRejection", (e) => onStray("unhandledRejection", e));
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (e) => {
    if (pipeGone(e)) shutdown(0);
  });
}
