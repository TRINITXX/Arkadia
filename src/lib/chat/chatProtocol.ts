/**
 * What the chat server (`chat-server/server.ts`) sends the page, one JSON
 * line per event, relayed by Rust as `chat-event`. SDK messages stay loosely
 * typed here: the page reads the few fields it shows and ignores the rest.
 */

import type { HandoffEvent } from "@chat-server/handoff";

export type JsonObject = Record<string, unknown>;

/** An agent of a running workflow, as its journal and transcript say. */
export interface WorkflowLiveAgent {
  agentId: string;
  label: string;
  phase: string;
  done: boolean;
  /** Its context now: the last reply's usage, as Claude Code counts it. */
  tokens?: number;
  model?: string;
  /** Its transcript's last write (epoch ms). */
  lastActivityAt?: number;
}

export type ChatEvent =
  | { type: "attached"; chatId: string }
  /** The end of what `attached` replays: the chat is current again. */
  | { type: "replayed"; chatId: string }
  | { type: "sdk"; chatId: string; message: JsonObject }
  | {
      type: "user_sent";
      chatId: string;
      text: string;
      images: number;
      /** The pasted images themselves, for the message's strip. */
      pasted?: { mediaType: string; data: string }[];
      /** The texts it sent from tags (`send`'s `pastes`). */
      pastes?: string[];
      /** Named by its `command_lifecycle` frames (absent: older server). */
      uuid?: string;
    }
  | ({
      type: "permission";
      chatId: string;
      requestId: string;
      toolName: string;
      input: JsonObject;
      toolUseId: string;
      title?: string;
      description?: string;
      decisionReason?: string;
      /** Rule changes that would stop Claude Code asking (`chatPermissions`). */
      suggestions?: PermissionUpdate[];
    } & PermissionAsk)
  | { type: "permission_resolved"; chatId: string; requestId: string }
  /** A message Claude Code took that the page doesn't show (not the user's
   *  own): its `origin.kind`, an artifact comment, an idle notice. Who
   *  opened a turn, for the notifications (`chatNotify`). */
  | {
      type: "user_origin";
      chatId: string;
      kind: string | null;
      artifact: boolean;
      idleNotice: boolean;
    }
  | {
      type: "context";
      chatId: string;
      percentage: number;
      totalTokens: number;
      maxTokens: number;
      /** The session's model now (after `/model` too). */
      model?: string;
    }
  /** `gitBranch` null: detached, or not a repository. `sessionId`: the
   *  session a (re)started chat resumes, before its first turn says so. */
  | {
      type: "info";
      chatId: string;
      title?: string;
      gitBranch?: string | null;
      sessionId?: string;
      /** The mode the chat starts in, before its first turn's init. */
      mode?: string;
      /** A /rewind's cut nothing was sent after yet; null: gone. */
      rewind?: { before: string; at: string } | null;
    }
  /** Claude Code's slash commands, at boot (`supportedCommands`). */
  | { type: "commands"; chatId: string; commands: SlashCommandInfo[] }
  /** A line of the server's own in the column (files of /rewind restored). */
  | { type: "notice"; chatId: string; text: string; tone: "info" | "error" }
  /** A big session gone cold continues in a new one (`chat-server/handoff.ts`). */
  | HandoffEvent
  /** Answers to `sessions` and `rewind_points` (not kept for a replay). */
  | {
      type: "sessions";
      chatId: string;
      requestId: string;
      sessions: SessionChoice[];
      error?: string;
    }
  | {
      type: "rewind_points";
      chatId: string;
      requestId: string;
      points: RewindPoint[];
      error?: string;
    }
  /** The plan's `/usage` windows, at boot and after each turn. */
  | { type: "usage"; chatId: string; rateLimits: JsonObject | null }
  | {
      type: "history";
      chatId: string;
      agentId?: string;
      messages: JsonObject[];
      truncated: boolean;
      /** A page before the oldest shown (`older`): it goes on top. */
      older?: boolean;
      /** Compacted since: nothing older can be read (`older` server-side). */
      unreachable?: boolean;
    }
  /** The model menu (`supportedModels`), at boot and on a replay. */
  | { type: "models"; chatId: string; models: JsonObject[] }
  /** The effort the next message runs at; null: the model takes none. */
  | { type: "effort"; chatId: string; effort: EffortLevel | null }
  /** The MCP servers and their state (`mcpServerStatus`), when it changes. */
  | { type: "mcp"; chatId: string; servers: McpServerInfo[] }
  /** An MCP server asks the user something (`onElicitation`). */
  | {
      type: "elicitation";
      chatId: string;
      requestId: string;
      request: ElicitationInfo;
    }
  /** Answered by the page, or dropped by Claude Code (interrupt, timeout). */
  | { type: "elicitation_resolved"; chatId: string; requestId: string }
  /** A message the user withdrew before Claude took it (`cancel_queued`). */
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
      detail?: ContextDetail;
      error?: string;
    }
  /** A running workflow's agents from its journal: live tokens, last write. */
  | {
      type: "workflow_live";
      chatId: string;
      taskId: string;
      agents: WorkflowLiveAgent[];
    }
  /** The end of a background shell's output (`task_output`; not kept for a replay). */
  | {
      type: "task_output";
      chatId: string;
      taskId: string;
      output: string;
      truncated: boolean;
      error?: string;
    }
  /**
   * Claude called `show_visual` (`chat-server/visual.ts`): the page, its
   * local images in, for the card and the page's offscreen check.
   */
  | {
      type: "visual_check";
      chatId: string;
      checkId: string;
      toolUseId: string | null;
      /** Null when replayed: the server sends the page live only. */
      html: string | null;
      title: string;
      wide: boolean;
      /** A copy with its images in was kept: ask `visual_html` for it. */
      stored?: boolean;
      /** The server's account key (`main` or an account id). */
      account?: string | null;
    }
  /** That check is over (reported or timed out). */
  | { type: "visual_checked"; chatId: string; checkId: string }
  /** A past visual's page with its images in; null: none kept (not replayed). */
  | {
      type: "visual_html";
      chatId: string;
      toolUseId: string;
      html: string | null;
    }
  /** Its Claude Code stopped while nothing ran (`chat-server/sleep.ts`): the column stays. */
  | { type: "asleep"; chatId: string }
  /** It starts again on the same session (a key typed, a command sent). */
  | { type: "awake"; chatId: string }
  /** A `!` command: `running`, then its end with what the column keeps. */
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
      /** It couldn't start (no Git Bash…). */
      error?: string;
      /** How much of the output Claude gets, of how much there was. */
      sent?: number;
      total?: number;
    }
  /** That command's entries are written: the chat no longer waits on it. */
  | { type: "bash_written"; chatId: string; id: string }
  /** A running `!` command's output as it comes (not replayed). */
  | {
      type: "bash_output";
      chatId: string;
      id: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  | { type: "closed"; chatId: string; error?: string }
  | { type: "error"; chatId?: string; message: string }
  /** From Rust: the server process of an account ended. */
  | { type: "server_exit"; account: string; error?: string };

/** A slash command as Claude Code lists it (the SDK's `SlashCommand`). */
export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
  /** Claude Code's own; absent for a user, project, plugin or MCP one. */
  builtin?: boolean;
}

/** A session of the chat's folder, for `/resume`. */
export interface SessionChoice {
  sessionId: string;
  title: string;
  /** Epoch ms. */
  lastModified: number;
  gitBranch?: string;
  /** Open in another chat of the same server. */
  open?: boolean;
  /** Its transcript's size, in bytes (« 12,4 Mo » in /resume). */
  size?: number;
}

/** A message the user wrote in the conversation, for `/rewind`. */
export interface RewindPoint {
  uuid: string;
  text: string;
  /** ISO time. */
  timestamp?: string;
}

/** What the page sends the chat server (`Command` in server.ts). */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto";

/** Where a permission rule is kept: a settings file, or the session alone. */
export type PermissionDestination =
  | "userSettings"
  | "projectSettings"
  | "localSettings"
  | "session"
  | "cliArg";

export interface PermissionRule {
  toolName: string;
  ruleContent?: string;
}

/** The SDK's `PermissionUpdate`. */
export type PermissionUpdate =
  | {
      type: "addRules" | "replaceRules" | "removeRules";
      rules: PermissionRule[];
      behavior: "allow" | "deny" | "ask";
      destination: PermissionDestination;
    }
  | {
      type: "setMode";
      mode: PermissionMode;
      destination: PermissionDestination;
    }
  | {
      type: "addDirectories" | "removeDirectories";
      directories: string[];
      destination: PermissionDestination;
    };

export type PermissionResult =
  | {
      behavior: "allow";
      updatedInput?: JsonObject;
      /** A suggestion taken: Claude Code applies it, as the terminal's « don't ask again ». */
      updatedPermissions?: PermissionUpdate[];
    }
  | { behavior: "deny"; message: string; interrupt?: boolean };

export type ChatCommand =
  | {
      type: "start";
      chatId: string;
      cwd: string;
      resume?: string;
      continue?: boolean;
      permissionMode?: PermissionMode;
      model?: string;
      /** The session's effort (a restart after the server stopped keeps it). */
      effort?: EffortLevel;
      /** The page shows the conversation already: its past goes to the log only. */
      keep?: boolean;
      /** A /rewind's cut still pending (`info.rewind`): resumed at it, never past. */
      historyBefore?: string;
      resumeSessionAt?: string;
      /** The server's restart cut a turn: the column says so. */
      cut?: boolean;
      /** Starts asleep: no Claude Code until woken. */
      asleep?: boolean;
      /** The Lab's sleep delay, for the whole server; null: never. */
      sleepAfterMs?: number | null;
    }
  | {
      type: "send";
      chatId: string;
      text: string;
      images?: { mediaType: string; data: string; label?: string }[];
      /** The texts in `text` pasted as tags (`chatPastes`): its frame shows
       *  them as tags again, on the phone too (`user_sent`). */
      pastes?: string[];
      /** « Envoyer maintenant »: Claude Code ends the turn under way for it. */
      priority?: "now";
      /**
       * Sent now while foreground Agent calls run (no `priority`): queued as
       * any message, then these go to the background and Claude takes it at
       * that boundary; a `now` would end their turn, and them with it.
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
  /** A subagent's conversation, for its sheet: the agent is required, never the session's. */
  | {
      type: "agent_history";
      chatId: string;
      sessionId: string;
      cwd: string;
      limit: number;
      agentId: string;
      to?: string;
    }
  | { type: "sessions"; chatId: string; requestId: string }
  | { type: "rewind_points"; chatId: string; requestId: string }
  /**
   * The chat's Claude Code again, on another session (`resume`, /resume) or
   * on its own cut just before a message of the user (`rewind`, /rewind),
   * the files restored too with `code`.
   */
  | {
      type: "relaunch";
      chatId: string;
      resume?: string;
      rewind?: { before: string; code: boolean };
      /** A handoff's « Reprendre l'ancienne en entier »: its next message resumes it, no handoff. */
      whole?: boolean;
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
  /** The `limit` messages of the session just before the message `before`. */
  | {
      type: "older";
      chatId: string;
      before: string;
      limit: number;
      to?: string;
    }
  /** The session's effort, for this session only (never saved). */
  | { type: "set_effort"; chatId: string; effort: EffortLevel }
  /** Withdraws a message Claude hasn't taken yet (`queued_removed`). */
  | { type: "cancel_queued"; chatId: string; uuid: string }
  /** A key typed in an asleep chat's input: its Claude Code starts again. */
  /** `slash`: the input starts with « / », a command: Claude Code wakes, no handoff is prepared. */
  | { type: "wake"; chatId: string; slash?: boolean }
  /** To sleep now if nothing runs nor waits (checks only). */
  | { type: "sleep"; chatId: string }
  /** The Lab's sleep delay changed, for the whole server; null: never. */
  | { type: "sleep_after"; chatId: string; ms: number | null }
  /** The pane shows again: the git branch looked at anew. */
  | { type: "refresh_branch"; chatId: string }
  /** `!command`: run in the chat's folder, its output to Claude with the next message. */
  | { type: "bash"; chatId: string; id: string; command: string }
  /** Esc on a running `!` command. */
  | { type: "bash_stop"; chatId: string; id: string }
  | {
      type: "elicit_answer";
      chatId: string;
      requestId: string;
      result: ElicitationAnswer;
    }
  /**
   * The context by category: token counts, so asked on hover only (on the
   * iPhone, a tap on its ring). `to`: a phone's ask, answered to it alone.
   */
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
  /** Plugins and skills read again from disk (plugin errors' « Recharger »). */
  | { type: "reload_plugins"; chatId: string }
  /** What the page's offscreen render of a visual found (`chatVisualProbe`). */
  | { type: "visual_report"; chatId: string; checkId: string; report: unknown }
  /** A past visual's page with its images in (answered by `visual_html`). */
  | { type: "visual_html"; chatId: string; toolUseId: string; to?: string }
  /**
   * The phone opened the chat: its life replayed to that phone alone
   * (`to`: `phone:<client>`), never to this page. `to` on a read above: its
   * answer goes to that phone alone too (`RemoteHub::chat_line`).
   */
  | { type: "phone_replay"; chatId: string; to: string }
  /** « Ouvrir dans le navigateur »: the page as the card shows it. */
  | { type: "visual_open"; chatId: string; html: string; title: string }
  | { type: "close"; chatId: string };

/** The SDK's `EffortLevel`, low to max. */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * What the SDK says of a permission request beyond its tool: a subagent's
 * (`agentId`), the path or MCP server it is about, and how cautious the
 * panel must be (`defaultToNo`, `suppressAlwaysAllowRule`).
 */
export interface PermissionAsk {
  /** Short noun phrase for the action (« Read file »). */
  displayName?: string;
  /** Open on Refuser: no single stray key approves. */
  defaultToNo?: boolean;
  /** No lasting « don't ask again »: its rule would grant more than this. */
  suppressAlwaysAllowRule?: boolean;
  /** The subagent asking (its task id), none for the main loop. */
  agentId?: string;
  /** The file path that made Claude Code ask. */
  blockedPath?: string;
  /** For an `mcp__*` tool: its server; `source` other than `sdk` is config. */
  mcpServer?: { name: string; source: string };
}

/** An MCP server and its state, as `mcpServerStatus` and `init` say. */
export interface McpServerInfo {
  name: string;
  /** connected, failed, needs-auth, pending, disabled (an open set). */
  status: string;
  /** Why it failed (`mcpServerStatus` only). */
  error?: string;
  /** Where it is configured: user, project, plugin, claudeai… */
  source?: string;
}

/** An MCP server's request to the user (the SDK's `ElicitationRequest`). */
export interface ElicitationInfo {
  serverName: string;
  message: string;
  /** `form`: fields of `requestedSchema`; `url`: a page to open (auth). */
  mode?: "form" | "url";
  url?: string;
  elicitationId?: string;
  requestedSchema?: JsonObject;
  title?: string;
  displayName?: string;
  description?: string;
}

/** The SDK's `ElicitationResult` (MCP `ElicitResult`). */
export interface ElicitationAnswer {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}

/** `getContextUsage({ detail: 'full' })`, cut to what the hover shows. */
export interface ContextDetail {
  categories: {
    id?: string;
    name: string;
    tokens: number;
    /** used, free, buffer, deferred (out of the window); an open set. */
    kind: string;
  }[];
  totalTokens: number;
  /** The window measured against (the autocompact one). */
  rawMaxTokens: number;
  memoryFiles: { path: string; tokens: number }[];
}
