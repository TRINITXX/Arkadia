// What a chat's Claude Code leaves running when its pane closes for good: a
// preview server or a watcher Claude started in a background shell outlives
// its Claude Code, since Windows never kills a process's children with it.
// Two such servers, from sessions closed earlier the same day, held 1.4 GB on
// 16/11/2026, nothing connected to them.
//
// Each Claude Code a chat runs is started here (`spawnClaudeCodeProcess`), its
// pid and lifetime kept in this server, across sleeps and relaunches. When the
// pane closes, each run's direct children born while it ran are killed, each
// with its tree. Out of reach: a program whose parent is gone, started
// detached (Windows' `start`, `Start-Process`: the way to keep one past the
// chat) or by a shell that has exited since (`npx vite &` in a one-off
// command); and what a run of an earlier server left (Arkadia restarted: its
// panes come back under new ids, the runs are not carried over).

import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import type {
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";

/** One Claude Code a chat ran: its pid, from its start to its exit (null while it runs). */
export interface ClaudeRun {
  pid: number;
  start: number;
  end: number | null;
}

/** A process as Windows lists it: its parent's pid and its birth (ms since epoch). */
export interface Proc {
  pid: number;
  ppid: number;
  created: number;
  name: string;
}

/** Windows' creation times and Node's clock may differ by this much. */
const CLOCK_SLACK_MS = 1_000;
/** A closed chat's Claude Code leaves within seconds (stdin closed, ~2 s grace, then killed); a subagent may hold it longer. */
const EXIT_WAIT_MS = 60_000;
/** What the column's error keeps of Claude Code's stderr, as the SDK's own spawn did (`stderrTail`). */
const STDERR_TAIL = 2_000;
/** The SDK's own spawn waited this long at most for stderr's end after an exit. */
const STDERR_DRAIN_MS = 200;
const SYSTEM32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");

interface Tracked extends ClaudeRun {
  exited: Promise<void>;
  stderr: string;
  stderrClosed: Promise<void>;
}

/** Every Claude Code each chat ran in this server, by chat id: kept across sleeps and relaunches. */
const runs = new Map<string, Tracked[]>();
/** Chats reaped already: a Claude Code started for one after its close is reaped once it exits. */
const reaped = new Set<string>();

/**
 * Starts a chat's Claude Code as the SDK would (`spawnLocalProcess`: piped
 * stdio, no window), its run kept for `reapChat`. Its stderr goes to `onStderr`,
 * the SDK's own `stderr` option being unused with a custom spawn.
 */
export function trackedSpawn(
  chatId: string,
  onStderr: (text: string) => void,
): (options: SpawnOptions) => SpawnedProcess {
  return (options) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stderrClosed = new Promise<void>((resolve) =>
      child.stderr.once("close", () => resolve()),
    );
    const run: Tracked | null =
      child.pid === undefined
        ? null
        : {
            pid: child.pid,
            start: Date.now(),
            end: null,
            exited: Promise.resolve(),
            stderr: "",
            stderrClosed,
          };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      if (run) run.stderr = (run.stderr + text).slice(-STDERR_TAIL);
      onStderr(text);
    });
    // An unread pipe would fill and stall Claude Code: read to its end, errors included.
    child.stderr.on("error", () => {});
    if (run) {
      run.exited = new Promise((resolve) => {
        child.once("exit", () => {
          run.end = Date.now();
          resolve();
        });
        child.once("error", () => resolve());
      });
      const list = runs.get(chatId) ?? [];
      list.push(run);
      runs.set(chatId, list);
      // Started after its pane closed (a chat closed while it booted): reaped once it exits.
      if (reaped.has(chatId)) void run.exited.then(() => reapChat(chatId));
    }
    return child;
  };
}

/**
 * The end of what the chat's last Claude Code wrote to stderr: why it stopped,
 * for the column. Waits for stderr's end, as the SDK's own spawn did.
 */
export async function stderrTail(chatId: string): Promise<string> {
  const last = runs.get(chatId)?.at(-1);
  if (!last) return "";
  await Promise.race([
    last.stderrClosed,
    new Promise((resolve) => setTimeout(resolve, STDERR_DRAIN_MS)),
  ]);
  return last.stderr.trim();
}

/**
 * The chat went on elsewhere (account switch, chat → terminal): its Claude
 * Code's programs are the session's, never killed for that.
 */
export function forgetChat(chatId: string): void {
  runs.delete(chatId);
}

/**
 * What to kill once a chat's Claude Code runs are over: each run's direct
 * children born while it ran (a later process that took its pid has its own),
 * and a run still alive (it outlived its close) with its tree.
 */
export function leftovers(
  list: readonly ClaudeRun[],
  procs: readonly Proc[],
  now: number,
): Proc[] {
  const out = new Map<number, Proc>();
  for (const run of list) {
    const from = run.start - CLOCK_SLACK_MS;
    const to = (run.end ?? now) + CLOCK_SLACK_MS;
    for (const p of procs) {
      if (p.ppid === run.pid && p.created >= from && p.created <= to)
        out.set(p.pid, p);
    }
    if (run.end === null) {
      const self = procs.find(
        (p) =>
          p.pid === run.pid &&
          Math.abs(p.created - run.start) <= CLOCK_SLACK_MS,
      );
      if (self) out.set(self.pid, self);
    }
  }
  return [...out.values()];
}

/** PowerShell's lines `pid ppid created-ms name`; a line it could not date is skipped. */
export function parseProcs(text: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d+) (\d+) (\d+) (.*)$/.exec(line.trim());
    if (!m) continue;
    procs.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      created: Number(m[3]),
      name: m[4],
    });
  }
  return procs;
}

const LIST_SCRIPT =
  "Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { " +
  "'{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, " +
  "([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(), $_.Name }";

function listProcs(): Promise<Proc[]> {
  return new Promise((resolve) => {
    execFile(
      join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", LIST_SCRIPT],
      { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (_error, stdout) => resolve(parseProcs(String(stdout ?? ""))),
    );
  });
}

function taskkill(pids: number[]): Promise<void> {
  return new Promise((resolve) => {
    const args = ["/F", "/T", ...pids.flatMap((p) => ["/PID", String(p)])];
    execFile(join(SYSTEM32, "taskkill.exe"), args, { windowsHide: true }, () =>
      resolve(),
    );
  });
}

/**
 * The chat's pane closed for good: once its Claude Code is gone, what it left
 * running is killed (`leftovers`), and the server's log says what.
 */
export async function reapChat(chatId: string): Promise<void> {
  reaped.add(chatId);
  const list = runs.get(chatId) ?? [];
  runs.delete(chatId);
  if (list.length === 0) return;
  await Promise.race([
    Promise.all(list.map((run) => run.exited)),
    new Promise((resolve) => setTimeout(resolve, EXIT_WAIT_MS)),
  ]);
  const left = leftovers(list, await listProcs(), Date.now());
  if (left.length === 0) return;
  await taskkill(left.map((p) => p.pid));
  process.stderr.write(
    `[reap] chat ${chatId}: taskkill on what its Claude Code left running: ${left.map((p) => `${p.name} ${p.pid}`).join(", ")}\n`,
  );
}
