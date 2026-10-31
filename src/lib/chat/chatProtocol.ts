/**
 * What the chat server (`chat-server/server.ts`) sends the page, one JSON
 * line per event, relayed by Rust as `chat-event`. SDK messages stay loosely
 * typed here: the page reads the few fields it shows and ignores the rest.
 */

export type JsonObject = Record<string, unknown>;

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
      /** Named by its `command_lifecycle` frames (absent: older server). */
      uuid?: string;
    }
  | {
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
    }
  | { type: "permission_resolved"; chatId: string; requestId: string }
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
    }
  /** Claude Code's slash commands, at boot (`supportedCommands`). */
  | { type: "commands"; chatId: string; commands: SlashCommandInfo[] }
  /** A line of the server's own in the column (files of /rewind restored). */
  | { type: "notice"; chatId: string; text: string; tone: "info" | "error" }
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
    }
  | {
      type: "send";
      chatId: string;
      text: string;
      images?: { mediaType: string; data: string }[];
      /** « Envoyer maintenant »: Claude Code ends the turn under way for it. */
      priority?: "now";
    }
  | { type: "interrupt"; chatId: string }
  | {
      type: "answer";
      chatId: string;
      requestId: string;
      result: PermissionResult;
    }
  | { type: "set_mode"; chatId: string; mode: PermissionMode }
  | { type: "set_model"; chatId: string; model: string }
  | {
      type: "history";
      chatId: string;
      sessionId: string;
      cwd: string;
      limit: number;
      agentId?: string;
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
    }
  /** /rewind's « code seul »: the files as they were before the message. */
  | { type: "restore_code"; chatId: string; before: string }
  | { type: "close"; chatId: string };
