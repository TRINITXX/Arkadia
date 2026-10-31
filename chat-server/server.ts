// Arkadia's chat server: drives Claude Code through the Agent SDK for the
// chat view, with no terminal. One process per Claude account (Arkadia sets
// CLAUDE_CONFIG_DIR for a secondary one, so the SDK's own session readers
// look in the right folder). It speaks NDJSON on stdio: commands in, events
// out. Every SDK message goes out as is: the page turns them into a chat.
//
// The conversation lives here, not in the page: each chat keeps the events of
// its life, and a page that reloads (Arkadia's watchdog rebuilds its window)
// gets them again by starting the same chat, while Claude goes on working.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  type PermissionUpdate,
  type Query,
  type SDKControlGetUsageResponse,
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
  | {
      type: "send";
      chatId: string;
      text: string;
      images?: ImageInput[];
      /** « Envoyer maintenant »: Claude Code stops the turn under way for it. */
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
      /** Only the latest messages: a long session holds thousands. */
      limit: number;
      /** A subagent's own conversation instead of the session's. */
      agentId?: string;
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
  | { type: "close"; chatId: string };

type StartCommand = Extract<Command, { type: "start" }>;

/** A start, plus what a /rewind relaunch adds (`Chat.relaunchStart`). */
type Boot = StartCommand & {
  /** The last entry kept: the SDK's `resumeSessionAt`. */
  resumeSessionAt?: string;
  /** The past shown stops before this message. */
  historyBefore?: string;
  /** Said first in the new column (the files restored). */
  notice?: string;
};

type SlashCommandInfo = Awaited<ReturnType<Query["supportedCommands"]>>[number];

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
    }
  /** Answered by the page, or dropped by Claude Code (interrupt, timeout). */
  | { type: "permission_resolved"; chatId: string; requestId: string }
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

/** The terminal's status line caches the branch 5 s; a chat looks every 10 s. */
const BRANCH_POLL_MS = 10_000;

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
  /** The branch last sent; undefined before the first look. */
  private branch: string | null | undefined;
  private branchTimer: ReturnType<typeof setInterval> | undefined;
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

  // No parameter properties: Node runs this file by stripping its types.
  constructor(chatId: string, start: Boot) {
    this.chatId = chatId;
    this.cwd = start.cwd;
    this.start = start;
    this.mode = start.permissionMode;
    this.model = start.model;
    this.cutBefore = start.historyBefore;
    if (start.notice) this.out({ type: "notice", chatId, text: start.notice, tone: "info" });
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
  private async boot(start: Boot): Promise<Query> {
    let resume = start.resume;
    if (!resume && start.continue) {
      const [latest] = await listSessions({ dir: start.cwd, limit: 1 });
      resume = latest?.sessionId;
    }
    if (resume) {
      this.sessionId = resume;
      const all = await getSessionMessages(resume, { dir: start.cwd });
      // Rewound: what follows the message gone back to isn't the past any more.
      const cut = all.findIndex((m) => m.uuid === start.historyBefore);
      const kept = cut >= 0 ? all.slice(0, cut) : all;
      const messages = kept.slice(-HISTORY_LIMIT);
      this.out({
        type: "history",
        chatId: this.chatId,
        messages,
        truncated: kept.length > messages.length,
      });
      void this.reportInfo();
    }
    const q = query({
      prompt: this.input,
      options: {
        cwd: start.cwd,
        resume,
        resumeSessionAt: start.resumeSessionAt,
        // /rewind's « le code aussi »: the terminal keeps these backups too.
        enableFileCheckpointing: true,
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
    this.pumping = this.pump(q);
    // The status bar's figures before any turn: these answer without one.
    void this.reportCommands(q);
    void this.reportUsage(q);
    void this.reportContext(q);
    void this.reportBranch();
    this.branchTimer = setInterval(() => void this.reportBranch(), BRANCH_POLL_MS);
    return q;
  }

  /** Sends an event to the page and keeps it for a later reattach. */
  private out(event: ServerEvent): void {
    if (this.silent) return;
    // Stamped: a page that reloads gets the times things happened.
    const stamped = { ...event, at: Date.now() };
    this.log.push(stamped);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    emit(stamped);
  }

  /** Replays the chat's life to a page that just (re)opened it. */
  replay(): void {
    emit({ type: "attached", chatId: this.chatId });
    // First: a long chat's log may have lost it, and the cards replayed
    // next need it to tell a command from words (`isCommandSent`).
    if (this.commands) emit({ type: "commands", chatId: this.chatId, commands: this.commands });
    for (const event of this.log) emit(event);
    emit({ type: "replayed", chatId: this.chatId });
    // The status bar's figures again: a long turn may have pushed them out of
    // the log, and the quotas replayed may date from long ago.
    this.branch = undefined;
    void this.reportBranch();
    void this.ready
      .then((q) => {
        void this.reportUsage(q);
        void this.reportContext(q);
      })
      .catch(() => {});
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const message of q) {
        // /clear: a reattach replays the new conversation alone. The command
        // list goes first of any replay (`this.commands`): a boot list kept
        // here would come after and override a newer one.
        if (message.type === "conversation_reset") {
          this.log = this.log.filter((e) => e.type === "info");
        }
        this.out({ type: "sdk", chatId: this.chatId, message });
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
        if (message.type === "result") {
          this.cutBefore = undefined;
          // A finished turn's text lives in its assistant messages: its
          // stream deltas no longer serve a replay.
          this.log = this.log.filter(
            (e) => e.type !== "sdk" || e.message.type !== "stream_event",
          );
          void this.reportContext(q);
          void this.reportUsage(q);
          void this.reportInfo();
          void this.reportBranch();
        }
      }
      this.out({ type: "closed", chatId: this.chatId });
    } catch (e) {
      this.out({ type: "closed", chatId: this.chatId, error: String(e) });
    } finally {
      clearInterval(this.branchTimer);
      // Stopped for a relaunch: its successor takes the place.
      if (!this.silent && chats.get(this.chatId) === this) chats.delete(this.chatId);
    }
  }

  /** 'summary': from the last response's usage, without token-count calls. */
  private async reportContext(q: Query): Promise<void> {
    try {
      const usage = await q.getContextUsage({ detail: "summary" });
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
    if (!this.sessionId) return;
    try {
      const info = await getSessionInfo(this.sessionId, { dir: this.cwd });
      if (!info) return;
      // A session opened by a command (/clear) is no title yet.
      const summary = info.summary.startsWith("/") ? undefined : info.summary;
      this.out({
        type: "info",
        chatId: this.chatId,
        title: info.customTitle ?? summary,
        sessionId: this.sessionId,
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
  send(text: string, images: ImageInput[] = [], priority?: "now"): void {
    const uuid = randomUUID();
    this.out({
      type: "user_sent",
      chatId: this.chatId,
      text,
      images: images.length,
      pasted: images,
      uuid,
    });
    this.input.push({
      type: "user",
      uuid,
      ...(priority ? { priority } : {}),
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
      const text = m.type === "user" ? promptText(m.message) : null;
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
    const base: Boot = {
      ...this.start,
      resume: undefined,
      continue: undefined,
      resumeSessionAt: undefined,
      historyBefore: undefined,
      permissionMode: this.mode,
      model: this.model,
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
    const q = await this.ready;
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

  close(): void {
    clearInterval(this.branchTimer);
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

/** How many of the folder's sessions /resume lists. */
const SESSIONS_LIMIT = 60;

/** How Claude Code opens the summary that replaces a compacted conversation. */
const COMPACT_SUMMARY = "This session is being continued from a previous conversation";

/** A message the user typed, or null: tool results, commands' output, notes. */
function promptText(message: unknown): string | null {
  const content = (message as { content?: unknown } | null)?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    const blocks = content as { type?: string; text?: string }[];
    if (blocks.some((b) => b?.type === "tool_result")) return null;
    text = blocks
      .filter((b) => b?.type === "text")
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

async function handle(cmd: Command): Promise<void> {
  // Awaited only when there is one: a relaunch registers itself before any
  // command read after it runs.
  const pending = relaunching.get(cmd.chatId);
  if (pending) await pending.catch(() => {});
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
      return chat.send(cmd.text, cmd.images, cmd.priority);
    case "interrupt":
      await chat.interrupt();
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
    case "restore_code":
      return chat.restoreCode(cmd.before).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        emit({ type: "error", chatId: cmd.chatId, message });
      });
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
