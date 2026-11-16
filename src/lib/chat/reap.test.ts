import { describe, expect, it } from "vitest";
import { leftovers, parseProcs, type Proc } from "../../../chat-server/reap.ts";

const proc = (
  pid: number,
  ppid: number,
  created: number,
  name = "node.exe",
): Proc => ({
  pid,
  ppid,
  created,
  name,
});

describe("what a closed chat's Claude Code left running (chat-server/reap.ts)", () => {
  it("kills the children a run started while it ran, never a process that took its pid later", () => {
    const run = { pid: 100, start: 10_000, end: 50_000 };
    const procs = [
      proc(200, 100, 20_000, "bash.exe"), // a preview server's shell, started by Claude
      proc(300, 100, 90_000, "cmd.exe"), // a child of whatever took pid 100 since
      proc(400, 999, 20_000, "node.exe"), // someone else's
    ];
    expect(leftovers([run], procs, 100_000).map((p) => p.pid)).toEqual([200]);
  });

  it("covers every run of the chat: one before a sleep, one after", () => {
    const runs = [
      { pid: 100, start: 0, end: 10_000 },
      { pid: 101, start: 20_000, end: 30_000 },
    ];
    const procs = [proc(200, 100, 5_000), proc(201, 101, 25_000)];
    expect(
      leftovers(runs, procs, 40_000)
        .map((p) => p.pid)
        .sort(),
    ).toEqual([200, 201]);
  });

  it("kills a run still alive past its close, but not another process on its pid", () => {
    const run = { pid: 100, start: 10_000, end: null };
    expect(
      leftovers([run], [proc(100, 1, 10_200, "claude.exe")], 99_000).map(
        (p) => p.pid,
      ),
    ).toEqual([100]);
    expect(
      leftovers([run], [proc(100, 1, 80_000, "notepad.exe")], 99_000),
    ).toEqual([]);
  });
});

describe("Windows' process list, as PowerShell prints it", () => {
  it("reads pid, parent, birth and name, names with spaces kept", () => {
    expect(
      parseProcs(
        "12 4 1763251200000 Code Helper.exe\r\nnoise\r\n34 12 1763251201000 node.exe\r\n",
      ),
    ).toEqual([
      { pid: 12, ppid: 4, created: 1763251200000, name: "Code Helper.exe" },
      { pid: 34, ppid: 12, created: 1763251201000, name: "node.exe" },
    ]);
  });
});
