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
  | { type: "user_sent"; chatId: string; text: string; images: number }
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
    }
  | { type: "permission_resolved"; chatId: string; requestId: string }
  | {
      type: "context";
      chatId: string;
      percentage: number;
      totalTokens: number;
      maxTokens: number;
    }
  /** `gitBranch` null: detached, or not a repository. */
  | { type: "info"; chatId: string; title?: string; gitBranch?: string | null }
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

/** What the page sends the chat server (`Command` in server.ts). */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto";

export type PermissionResult =
  | { behavior: "allow"; updatedInput?: JsonObject }
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
  | { type: "close"; chatId: string };
