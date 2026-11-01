// The user's `!` commands, as the terminal's bash mode runs them: in the
// chat's folder, by Git Bash (the shell Claude Code's Bash tool uses on
// Windows), with the chat's env. Their output streams to the page, and
// Claude gets the command and its output with the next message, in Claude
// Code's own transcript tags (`<bash-input>`, `<bash-stdout>`, `<bash-stderr>`,
// seen in ~/.claude/projects on 01/11/2026), sent as messages that start no
// turn (`shouldQuery: false`, the SDK's way for « CCD bash mode »).

import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { consoleText, cp850 } from "./taskOutput.ts";

/** At most this much of the output goes to Claude: Claude Code's own `bashOutputMaxChars` default. */
export const BANG_SENT_MAX = 30_000;
/** At most this much of each stream is kept for the column (the chat's log too). */
export const BANG_SHOWN_MAX = 60_000;

/** What a stream wrote, as kept: its start and its end, `room` each, and its whole length. */
export interface Kept {
  head: string;
  tail: string;
  total: number;
}

export const NOTHING_KEPT: Kept = { head: "", tail: "", total: 0 };

/** A stream's next chunk: its start fills first, then its end rolls. */
export function keep(kept: Kept, text: string, room: number): Kept {
  const total = kept.total + text.length;
  const take = Math.max(0, room - kept.head.length);
  const head = kept.head + text.slice(0, take);
  const tail = (kept.tail + text.slice(take)).slice(-room);
  return { head, tail, total };
}

/** The stream within `max` characters: whole, or its start and end, the cut said between. */
export function keptText(kept: Kept, max: number): { text: string; cut: number } {
  const whole = kept.head.length + kept.tail.length === kept.total;
  if (whole && kept.total <= max) return { text: kept.head + kept.tail, cut: 0 };
  const half = Math.floor(max / 2);
  const start = kept.head.slice(0, half);
  const end = whole ? (kept.head + kept.tail).slice(-half) : kept.tail.slice(-half);
  const cut = kept.total - start.length - end.length;
  return { text: `${start}\n… [${cut} characters cut] …\n${end}`, cut };
}

/** Claude Code writes the output with its tags' characters escaped (`&gt;`, `&amp;`), never the command. */
export function escapeOutput(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Claude Code's words for a command that printed nothing. */
const NO_OUTPUT = "(Bash completed with no output)";

/**
 * The two transcript entries Claude Code writes for a `!` command, its
 * output cut to `max` in all (errors keep a third of it when both streams
 * overflow), and how much Claude gets of how much there was.
 */
export function bangBlocks(
  command: string,
  stdout: Kept,
  stderr: Kept,
  stopped: boolean,
  max = BANG_SENT_MAX,
): { input: string; output: string; sent: number; total: number } {
  const errRoom = Math.min(stderr.total, Math.max(Math.floor(max / 3), max - stdout.total));
  const out = keptText(stdout, max - errRoom);
  const err = keptText(stderr, errRoom);
  const errText = stopped ? `${err.text}${err.text ? "\n" : ""}[Command stopped by the user]` : err.text;
  const outText = out.text || (errText ? "" : NO_OUTPUT);
  return {
    input: `<bash-input>${command}</bash-input>`,
    output: `<bash-stdout>${escapeOutput(outText)}</bash-stdout><bash-stderr>${escapeOutput(errText)}</bash-stderr>`,
    sent: stdout.total - out.cut + stderr.total - err.cut,
    total: stdout.total + stderr.total,
  };
}

/**
 * Claude Code's frames about our entries (by uuid): a lifecycle frame
 * `completed` or `cancelled` says one written; a turn's result names those
 * it took (`user_message_uuids`), and one that took only ours without the
 * model (`num_turns` 0) is a turn of no one, swallowed. Entries queued
 * behind a turn come in one such result together; ones taken along with a
 * message of the user ride its real turn (`taken`, not swallowed).
 */
export function entriesEnd(
  m: Record<string, unknown>,
  ours: ReadonlySet<string>,
): { written: string[]; swallow: boolean; taken: boolean } {
  if (m.type === "command_lifecycle") {
    const uuid = m.command_uuid;
    const done = m.state === "completed" || m.state === "cancelled";
    const written = done && typeof uuid === "string" && ours.has(uuid) ? [uuid] : [];
    return { written, swallow: false, taken: false };
  }
  if (m.type !== "result") return { written: [], swallow: false, taken: false };
  const listed = Array.isArray(m.user_message_uuids) ? m.user_message_uuids : [];
  const written = listed.filter((u): u is string => typeof u === "string" && ours.has(u));
  const swallow = written.length > 0 && written.length === listed.length && m.num_turns === 0;
  return { written, swallow, taken: written.length > 0 };
}

/**
 * Git Bash, as Claude Code finds it: its own setting, then the Git that
 * `git.exe` on the PATH belongs to (`<git>\cmd`, `<git>\bin`,
 * `<git>\mingw64\bin`), then the usual install folders.
 */
export function gitBash(env: Record<string, string | undefined>): string | null {
  const set = env.CLAUDE_CODE_GIT_BASH_PATH;
  if (set && existsSync(set)) return set;
  const path = env.PATH ?? env.Path ?? "";
  for (const dir of path.split(";")) {
    if (!dir || !existsSync(join(dir, "git.exe"))) continue;
    for (const root of [dirname(dir), dirname(dirname(dir))]) {
      const bash = join(root, "bin", "bash.exe");
      if (existsSync(bash)) return bash;
    }
  }
  const local = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs") : undefined;
  for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"], local]) {
    const bash = root ? join(root, "Git", "bin", "bash.exe") : "";
    if (bash && existsSync(bash)) return bash;
  }
  return null;
}

/**
 * The command reaches bash through the env, never its command line: Windows
 * and MSYS quote arguments each their own way, a variable goes as it is.
 * First, bash says its process group on stderr (`GROUP_LINE`, dropped): a
 * job it leaves in the background (`cmd &`) keeps that group after bash
 * and its Windows parent are gone, so a stop finds it there.
 */
const BANG_VAR = "ARKADIA_BANG";
const BANG_SCRIPT = `read -r g < /proc/$$/pgid 2>/dev/null; printf '\\036ARKADIA_PGID %s\\036\\n' "$g" >&2; c=$${BANG_VAR}; unset ${BANG_VAR}; eval "$c"`;
const GROUP_LINE = /^\x1eARKADIA_PGID (\d*)\x1e\r?\n/;

/**
 * Bash exited: what it wrote still in the pipes comes within this. A job it
 * left in the background holds the pipes open: the command ends anyway.
 */
export const BANG_DRAIN_MS = 300;

/** How many bytes at the end of a chunk start a UTF-8 character it cuts (0 to 3). */
export function utf8Tail(bytes: Uint8Array): number {
  const n = bytes.length;
  for (let back = 1; back <= Math.min(3, n); back++) {
    const b = bytes[n - back];
    if ((b & 0xc0) === 0x80) continue;
    if (b < 0xc0) return 0;
    const size = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
    return back < size ? back : 0;
  }
  return 0;
}

/**
 * A console's bytes as text as they come, each line UTF-8 when valid, else
 * the OEM page: a progress bar (`\r`) or a line without end shows at once,
 * only a character the chunk cuts waits for the next one (never more than
 * 3 bytes held).
 */
export class ConsoleDecoder {
  private rest = new Uint8Array(0);

  push(chunk: Uint8Array): string {
    let bytes = chunk;
    if (this.rest.length > 0) {
      bytes = new Uint8Array(this.rest.length + chunk.length);
      bytes.set(this.rest);
      bytes.set(chunk, this.rest.length);
    }
    const held = utf8Tail(bytes);
    this.rest = bytes.slice(bytes.length - held);
    return consoleText(bytes.subarray(0, bytes.length - held), cp850);
  }

  end(): string {
    const rest = this.rest;
    this.rest = new Uint8Array(0);
    return rest.length > 0 ? consoleText(rest, cp850) : "";
  }
}

/** The MSYS script that lists the Windows pids of a process group's members. */
export function groupScript(group: string): string {
  return `for p in /proc/[0-9]*; do read -r g < "$p/pgid" 2>/dev/null && [ "$g" = "${group}" ] && read -r w < "$p/winpid" 2>/dev/null && echo "$w"; done`;
}

/** The pids a listing printed, one per line. */
export function readPids(text: string): number[] {
  return text
    .split(/\s+/)
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
}

/**
 * Kills a command's processes: bash's own tree, and every member of its
 * process group, background jobs left behind included, each with its tree
 * (a native program's own children: `npm run dev` → node).
 */
function killBang(
  bash: string,
  env: Record<string, string>,
  group: string | null,
  pid: number | undefined,
): Promise<void> {
  return new Promise((resolve) => {
    const kill = (pids: number[]) => {
      if (pids.length === 0) return resolve();
      const args = ["/F", "/T", ...pids.flatMap((p) => ["/PID", String(p)])];
      execFile("taskkill", args, { windowsHide: true }, () => resolve());
    };
    const own = pid === undefined ? [] : [pid];
    if (!group) return kill(own);
    execFile(
      bash,
      ["-c", groupScript(group)],
      { env, windowsHide: true, timeout: 10_000 },
      (_error, stdout) => kill([...own, ...readPids(String(stdout ?? ""))]),
    );
  });
}

export interface BangEnd {
  /** Bash's exit code; null when stopped or never started. */
  code: number | null;
  stopped: boolean;
  /** It couldn't start (no Git Bash, a folder gone). */
  error?: string;
}

export interface BangRun {
  /** Bash's end (plus `BANG_DRAIN_MS`), never a background job's. */
  done: Promise<BangEnd>;
  /** Esc: the command and every process it started; resolves once killed. */
  stop(): Promise<void>;
}

/** Runs one `!` command; `onOutput` hears each stream's text as it comes. */
export function runBang(
  command: string,
  cwd: string,
  env: Record<string, string>,
  onOutput: (stream: "stdout" | "stderr", text: string) => void,
): BangRun {
  const bash = gitBash(env);
  if (!bash) {
    return {
      done: Promise.resolve({ code: null, stopped: false, error: "Git Bash introuvable : installe Git for Windows" }),
      stop: () => Promise.resolve(),
    };
  }
  let stopped = false;
  let ended = false;
  /** Bash's process group, once it said it (`GROUP_LINE`). */
  let group: string | null = null;
  /** Stderr's start until the group's line is read off it. */
  let errHead: string | null = "";
  const child = spawn(bash, ["-c", BANG_SCRIPT], {
    cwd,
    env: { ...env, [BANG_VAR]: command },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forward = (stream: "stdout" | "stderr", text: string, last = false) => {
    if (stream === "stderr" && errHead !== null) {
      errHead += text;
      const line = GROUP_LINE.exec(errHead);
      // Waits for the whole line, a few bytes at most.
      if (!line && !last && errHead.startsWith("\x1e") && errHead.length < 64) return;
      if (line) group = line[1] || null;
      text = line ? errHead.slice(line[0].length) : errHead;
      errHead = null;
    }
    if (text) onOutput(stream, text);
  };
  const decoders = { stdout: new ConsoleDecoder(), stderr: new ConsoleDecoder() };
  for (const stream of ["stdout", "stderr"] as const) {
    // Read to the end, even past the command's: a background job writing to
    // a pipe nobody reads would block or die.
    child[stream].on("data", (chunk: Buffer) => {
      if (!ended) forward(stream, decoders[stream].push(chunk));
    });
  }
  let exitCode: number | null = null;
  let drain: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<BangEnd>((resolve) => {
    const finish = () => {
      if (ended) return;
      clearTimeout(drain);
      for (const stream of ["stdout", "stderr"] as const) forward(stream, decoders[stream].end(), true);
      ended = true;
      resolve({ code: stopped ? null : exitCode, stopped });
    };
    child.on("error", (e) => {
      if (ended) return;
      ended = true;
      resolve({ code: null, stopped, error: String(e) });
    });
    child.on("exit", (code) => {
      exitCode = code;
      drain = setTimeout(finish, BANG_DRAIN_MS);
    });
    child.on("close", finish);
  });
  return {
    done,
    stop: () => {
      // Ended: what it left in the background is the user's, as in a terminal.
      if (stopped || ended) return Promise.resolve();
      stopped = true;
      // Bash may be gone already, its background jobs not.
      return killBang(bash, env, group, child.pid);
    },
  };
}
