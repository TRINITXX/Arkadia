import { describe, expect, it } from "vitest";
import {
  grepLines,
  listLines,
  run,
  showCall,
  SHOW_MAX_CHARS,
  toolCalls,
} from "../../../chat-server/transcript.ts";
import type { Entry } from "../../../chat-server/handoff.ts";

const call = (
  id: string,
  name: string,
  input: Record<string, unknown>,
): Entry => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const result = (id: string, content: unknown, isError = false): Entry => ({
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, content, is_error: isError },
    ],
  },
});

const entries: Entry[] = [
  { type: "user", message: { content: "Lance le build" } },
  call("a", "Bash", { command: "npm run build", description: "Build" }),
  result("a", "BUILD FAILED: missing semicolon", true),
  call("b", "Read", { file_path: "src/price.ts" }),
  result("b", [{ type: "text", text: "export const price = 1" }]),
  { ...call("c", "Bash", { command: "secret" }), isSidechain: true },
];

describe("reading an old session's transcript (chat-server/transcript.ts)", () => {
  it("numbers the main thread's calls with their results", () => {
    const calls = toolCalls(entries);
    expect(calls.map((c) => [c.n, c.name, c.isError])).toEqual([
      [1, "Bash", true],
      [2, "Read", false],
    ]);
    expect(calls[1].result).toBe("export const price = 1");
  });

  it("lists one line a call, filtered by tool or subject", () => {
    const lines = listLines(toolCalls(entries), "price");
    expect(lines).toEqual(["#2 Read · src/price.ts → 22 car."]);
  });

  it("shows a call whole, and pages a long one", () => {
    const calls = toolCalls(entries);
    expect(showCall(calls, 1)).toContain("BUILD FAILED");
    expect(showCall(calls, 9)).toBe("Pas d'appel #9 (il y en a 2).");
    const long = toolCalls([
      call("x", "Bash", { command: "cat" }),
      result("x", "y".repeat(SHOW_MAX_CHARS + 500)),
    ]);
    const first = showCall(long, 1);
    expect(first).toMatch(/caractères de plus : show 1 \d+\]$/);
    const next = Number(/show 1 (\d+)\]$/.exec(first)?.[1]);
    expect(showCall(long, 1, next).length).toBeLessThan(SHOW_MAX_CHARS);
  });

  it("finds a word in the words and in the results", () => {
    const found = grepLines(entries, toolCalls(entries), "build");
    expect(found.some((l) => l.startsWith("Alexis : "))).toBe(true);
    expect(found.some((l) => l.startsWith("#1 Bash : "))).toBe(true);
  });

  it("answers its command line, its usage when misused", () => {
    const text = entries.map((e) => JSON.stringify(e)).join("\n");
    expect(run(["list", "f.jsonl"], () => text)).toContain(
      "#1 Bash · npm run build",
    );
    expect(
      run(["grep", "f.jsonl", "missing", "semicolon"], () => text),
    ).toContain("missing semicolon");
    expect(run([], () => text)).toMatch(/^usage/);
  });
});
