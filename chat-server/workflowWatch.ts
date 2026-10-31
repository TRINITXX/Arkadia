// A running workflow seen from its folder (the Workflow tool's
// `transcriptDir`): `journal.jsonl` names each agent as it starts and ends,
// `agent-<id>.jsonl` is its transcript. The SDK's `workflow_progress` gives
// an agent's figures only at its start and end; this adds, while it runs,
// its tokens (its last reply's usage, as Claude Code counts them) and the
// time of its last write (the card's idle time). Checked on 2.1.314.

import { open, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

export interface WorkflowLiveAgent {
  agentId: string;
  label: string;
  phase: string;
  done: boolean;
  tokens?: number;
  model?: string;
  lastActivityAt?: number;
}

/** How often a running workflow's folder is looked at. */
const POLL_MS = 1_500;

const NEWLINE = 0x0a;

/** A file that grows by lines: each look reads only what was added. */
class Tail {
  private path: string;
  private offset = 0;
  /** An unfinished last line, as bytes: a character may be cut in two. */
  private rest = Buffer.alloc(0);

  constructor(path: string) {
    this.path = path;
  }

  /** The complete lines written since the last look; none if no file yet. */
  async lines(): Promise<string[]> {
    let handle: FileHandle;
    try {
      handle = await open(this.path, "r");
    } catch {
      return [];
    }
    try {
      const { size } = await handle.stat();
      if (size <= this.offset) return [];
      const added = Buffer.alloc(size - this.offset);
      const { bytesRead } = await handle.read(
        added,
        0,
        added.length,
        this.offset,
      );
      this.offset += bytesRead;
      const all = Buffer.concat([this.rest, added.subarray(0, bytesRead)]);
      const end = all.lastIndexOf(NEWLINE);
      if (end < 0) {
        this.rest = all;
        return [];
      }
      this.rest = all.subarray(end + 1);
      return all.subarray(0, end).toString("utf8").split("\n").filter(Boolean);
    } finally {
      await handle.close();
    }
  }
}

type Look = WorkflowLiveAgent & { tail: Tail; path: string; read: boolean };

const parse = (line: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export class WorkflowWatch {
  private dir: string;
  private journal: Tail;
  private agents = new Map<string, Look>();
  private onChange: (agents: WorkflowLiveAgent[]) => void;
  private timer: ReturnType<typeof setInterval>;
  private looking = false;
  private sent = "";

  constructor(dir: string, onChange: (agents: WorkflowLiveAgent[]) => void) {
    this.dir = dir;
    this.journal = new Tail(join(dir, "journal.jsonl"));
    this.onChange = onChange;
    this.timer = setInterval(() => void this.look(), POLL_MS);
    void this.look();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private async look(): Promise<void> {
    if (this.looking) return;
    this.looking = true;
    try {
      for (const line of await this.journal.lines()) {
        const e = parse(line);
        const agentId = typeof e?.agentId === "string" ? e.agentId : null;
        if (!e || !agentId) continue;
        const known = this.agents.get(agentId);
        if (e.type === "started" && !known) {
          const path = join(this.dir, `agent-${agentId}.jsonl`);
          this.agents.set(agentId, {
            agentId,
            label: typeof e.label === "string" ? e.label : agentId,
            phase: typeof e.phase === "string" ? e.phase : "",
            done: false,
            tail: new Tail(path),
            path,
            read: false,
          });
        } else if (e.type === "result" && known) {
          known.done = true;
        }
      }
      for (const a of this.agents.values()) {
        // An agent that ended is read once more, then left.
        if (a.done && a.read) continue;
        for (const line of await a.tail.lines()) {
          // Most lines are attachments: only replies carry usage.
          if (!line.includes('"assistant"')) continue;
          const m = parse(line);
          const message =
            m?.type === "assistant"
              ? (m.message as Record<string, unknown>)
              : null;
          const usage = message?.usage as Record<string, unknown> | undefined;
          if (!usage) continue;
          a.tokens =
            num(usage.input_tokens) +
            num(usage.cache_creation_input_tokens) +
            num(usage.cache_read_input_tokens) +
            num(usage.output_tokens);
          if (typeof message?.model === "string") a.model = message.model;
        }
        try {
          // To the second: an agent writing all the time sends one update per look.
          a.lastActivityAt =
            Math.floor((await stat(a.path)).mtimeMs / 1000) * 1000;
        } catch {
          // No transcript yet.
        }
        a.read = a.done;
      }
      const agents = [...this.agents.values()].map(
        ({ agentId, label, phase, done, tokens, model, lastActivityAt }) => ({
          agentId,
          label,
          phase,
          done,
          tokens,
          model,
          lastActivityAt,
        }),
      );
      const key = JSON.stringify(agents);
      if (agents.length > 0 && key !== this.sent) {
        this.sent = key;
        this.onChange(agents);
      }
    } finally {
      this.looking = false;
    }
  }
}
