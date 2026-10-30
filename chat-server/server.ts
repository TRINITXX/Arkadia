// Arkadia's chat server: drives Claude Code through the Agent SDK for the
// chat view, with no terminal. One process per Claude account (Arkadia sets
// CLAUDE_CONFIG_DIR for a secondary one, so the SDK's own session readers
// look in the right folder). It speaks NDJSON on stdio: commands in, events
// out. Every SDK message goes out as is: the page turns them into a chat.
//
// The conversation lives here, not in the page: each chat keeps the events of
// its life, and a page that reloads (Arkadia's watchdog rebuilds its window)
// gets them again by starting the same chat, while Claude goes on working.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSessions,
  query,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

type ImageInput = { mediaType: string; data: string };

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
    }
  | { type: "send"; chatId: string; text: string; images?: ImageInput[] }
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
      /** Only the latest messages: a long session holds thousands. */
      limit: number;
      /** A subagent's own conversation instead of the session's. */
      agentId?: string;
    }
  | { type: "close"; chatId: string };

export type ServerEvent =
  /** A start found the chat running: its events follow, from the beginning. */
  | { type: "attached"; chatId: string }
  /** The end of that replay. */
  | { type: "replayed"; chatId: string }
  | { type: "sdk"; chatId: string; message: SDKMessage }
  /** What the user sent: the SDK doesn't echo it. */
  | { type: "user_sent"; chatId: string; text: string; images: number }
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
    }
  /** Answered by the page, or dropped by Claude Code (interrupt, timeout). */
  | { type: "permission_resolved"; chatId: string; requestId: string }
  | {
      type: "context";
      chatId: string;
      percentage: number;
      totalTokens: number;
      maxTokens: number;
    }
  /** The session's title and git branch, for the column and status bar. */
  | { type: "info"; chatId: string; title?: string; gitBranch?: string }
  | {
      type: "history";
      chatId: string;
      agentId?: string;
      messages: unknown[];
      /** More messages exist before the first one sent. */
      truncated: boolean;
    }
  | { type: "closed"; chatId: string; error?: string }
  | { type: "error"; chatId?: string; message: string };

function emit(event: ServerEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
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

/** Past this, the oldest events of a long chat are dropped from its log. */
const LOG_LIMIT = 20_000;

/** How much of a resumed session's past the column gets. */
const HISTORY_LIMIT = 400;

class Chat {
  private chatId: string;
  private cwd: string;
  private input = new InputQueue();
  private query: Query | null = null;
  /** Resolves once the query runs: commands wait for it. */
  private ready: Promise<Query>;
  /** Permission requests waiting for the page, by SDK request id. */
  private pending = new Map<string, (result: PermissionResult) => void>();
  /** Everything sent to the page, for a page that comes back. */
  private log: ServerEvent[] = [];
  private sessionId: string | undefined;

  // No parameter properties: Node runs this file by stripping its types.
  constructor(chatId: string, start: Extract<Command, { type: "start" }>) {
    this.chatId = chatId;
    this.cwd = start.cwd;
    this.ready = this.boot(start);
    this.ready.catch((e: unknown) => {
      this.out({ type: "closed", chatId, error: String(e) });
      if (chats.get(chatId) === this) chats.delete(chatId);
    });
  }

  /**
   * A resumed session first gets its past, kept in the log like the rest:
   * read before Claude Code runs, it holds nothing of this chat. `continue`
   * becomes the folder's latest session, so its past can be read too.
   */
  private async boot(start: Extract<Command, { type: "start" }>): Promise<Query> {
    let resume = start.resume;
    if (!resume && start.continue) {
      const [latest] = await listSessions({ dir: start.cwd, limit: 1 });
      resume = latest?.sessionId;
    }
    if (resume) {
      this.sessionId = resume;
      const all = await getSessionMessages(resume, { dir: start.cwd });
      const messages = all.slice(-HISTORY_LIMIT);
      this.out({
        type: "history",
        chatId: this.chatId,
        messages,
        truncated: all.length > messages.length,
      });
      void this.reportInfo();
    }
    const q = query({
      prompt: this.input,
      options: {
        cwd: start.cwd,
        resume,
        model: start.model,
        // As the terminal's `ccd`: auto mode, bypass reachable by Shift+Tab.
        permissionMode: start.permissionMode ?? "auto",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: claudeExecutable(),
        env: { ...process.env, ...start.env } as Record<string, string>,
        canUseTool: (toolName, input, options) =>
          this.askPage(toolName, input, options),
        stderr: (data) => process.stderr.write(`[${this.chatId}] ${data}`),
      },
    });
    this.query = q;
    void this.pump(q);
    return q;
  }

  /** Sends an event to the page and keeps it for a later reattach. */
  private out(event: ServerEvent): void {
    this.log.push(event);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    emit(event);
  }

  /** Replays the chat's life to a page that just (re)opened it. */
  replay(): void {
    emit({ type: "attached", chatId: this.chatId });
    for (const event of this.log) emit(event);
    emit({ type: "replayed", chatId: this.chatId });
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const message of q) {
        this.out({ type: "sdk", chatId: this.chatId, message });
        if (message.type === "system" && message.subtype === "init") {
          this.sessionId = message.session_id;
        }
        if (message.type === "result") {
          // A finished turn's text lives in its assistant messages: its
          // stream deltas no longer serve a replay.
          this.log = this.log.filter(
            (e) => e.type !== "sdk" || e.message.type !== "stream_event",
          );
          void this.reportContext(q);
          void this.reportInfo();
        }
      }
      this.out({ type: "closed", chatId: this.chatId });
    } catch (e) {
      this.out({ type: "closed", chatId: this.chatId, error: String(e) });
    } finally {
      if (chats.get(this.chatId) === this) chats.delete(this.chatId);
    }
  }

  private async reportContext(q: Query): Promise<void> {
    try {
      const usage = await q.getContextUsage();
      this.out({
        type: "context",
        chatId: this.chatId,
        percentage: usage.percentage,
        totalTokens: usage.totalTokens,
        maxTokens: usage.rawMaxTokens,
      });
    } catch {
      // The chat closed meanwhile.
    }
  }

  private async reportInfo(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const info = await getSessionInfo(this.sessionId, { dir: this.cwd });
      if (!info) return;
      this.out({
        type: "info",
        chatId: this.chatId,
        title: info.customTitle ?? info.summary,
        gitBranch: info.gitBranch,
      });
    } catch {
      // No transcript yet.
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

  send(text: string, images: ImageInput[] = []): void {
    this.out({ type: "user_sent", chatId: this.chatId, text, images: images.length });
    this.input.push({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: img.mediaType as "image/png",
              data: img.data,
            },
          })),
          { type: "text" as const, text },
        ],
      },
    });
  }

  async interrupt(): Promise<void> {
    await (await this.ready).interrupt();
  }

  async setMode(mode: PermissionMode): Promise<void> {
    await (await this.ready).setPermissionMode(mode);
  }

  async setModel(model: string): Promise<void> {
    await (await this.ready).setModel(model);
  }

  close(): void {
    for (const resolve of this.pending.values()) {
      resolve({ behavior: "deny", message: "Chat closed" });
    }
    this.pending.clear();
    this.input.end();
    this.query?.close();
    // Still booting: close the query as soon as it exists.
    void this.ready.then((q) => q.close()).catch(() => {});
  }
}

const chats = new Map<string, Chat>();

async function history(cmd: Extract<Command, { type: "history" }>) {
  const all = cmd.agentId
    ? await getSubagentMessages(cmd.sessionId, cmd.agentId, { dir: cmd.cwd })
    : await getSessionMessages(cmd.sessionId, { dir: cmd.cwd });
  const messages = all.slice(-cmd.limit);
  emit({
    type: "history",
    chatId: cmd.chatId,
    agentId: cmd.agentId,
    messages,
    truncated: all.length > messages.length,
  });
}

async function handle(cmd: Command): Promise<void> {
  if (cmd.type === "start") {
    // A page that reloads starts its chats again: they keep running.
    const running = chats.get(cmd.chatId);
    if (running) return running.replay();
    chats.set(cmd.chatId, new Chat(cmd.chatId, cmd));
    return;
  }
  if (cmd.type === "history") return history(cmd);
  const chat = chats.get(cmd.chatId);
  // Arkadia closes the chat of every pane it closes, chat or not.
  if (!chat && cmd.type === "close") return;
  if (!chat) {
    emit({ type: "error", chatId: cmd.chatId, message: "Conversation fermée" });
    return;
  }
  switch (cmd.type) {
    case "send":
      return chat.send(cmd.text, cmd.images);
    case "interrupt":
      await chat.interrupt();
      return;
    case "answer":
      return chat.answer(cmd.requestId, cmd.result);
    case "set_mode":
      return chat.setMode(cmd.mode);
    case "set_model":
      return chat.setModel(cmd.model);
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
    emit({ type: "error", chatId: "chatId" in cmd ? cmd.chatId : undefined, message: String(e) }),
  );
});
// Arkadia closed our stdin: it is gone, so are the chats.
lines.on("close", () => {
  for (const chat of chats.values()) chat.close();
  process.exit(0);
});
