import { describe, expect, it } from "vitest";
import type { ToolItem } from "@/lib/chat/chatGroups";
import type { LiveTool } from "@/lib/chat/chatState";
import {
  LONG_TURN_MS,
  STEP_TIME_MS,
  lastStep,
  liveElapsed,
  liveStep,
  timedCall,
  toolStep,
  turnDoneLine,
} from "@/lib/chat/chatSteps";

const CWD = "C:\\Users\\TRINITX\\Desktop\\proj";

describe("toolStep", () => {
  it("words each call as the terminal's display mod does", () => {
    const step = (name: string, input: Record<string, unknown>) =>
      toolStep(name, input, CWD);
    expect(step("Read", { file_path: `${CWD}\\src\\export.ts` })).toBe(
      "lit src/export.ts",
    );
    expect(step("Edit", { file_path: `${CWD}\\price.ts` })).toBe(
      "modifie price.ts",
    );
    expect(step("Grep", { pattern: "useChat" })).toBe("cherche « useChat »");
    expect(step("Agent", { description: "Explorer le code" })).toBe(
      "délègue : Explorer le code",
    );
    expect(step("WebSearch", { query: "x" })).toBe("consulte le web");
    expect(step("Skill", { skill: "commit" })).toBe("lance commit");
    expect(
      step("Bash", { command: "pnpm test", description: "Lancer les tests" }),
    ).toBe("lancer les tests");
    expect(step("Bash", { command: "pnpm test\necho ok" })).toBe(
      "lance pnpm test",
    );
  });

  it("names a file outside the project from the home folder", () => {
    expect(
      toolStep(
        "Read",
        { file_path: "C:\\Users\\TRINITX\\.claude\\CLAUDE.md" },
        CWD,
      ),
    ).toBe("lit ~/.claude/CLAUDE.md");
  });
});

describe("liveStep", () => {
  it("shows the latest running call, a subagent's prefixed", () => {
    expect(
      liveStep(
        [
          { id: "a", name: "Agent", input: { description: "d" }, agent: false },
          {
            id: "b",
            name: "Read",
            input: { file_path: `${CWD}\\a.ts` },
            agent: true,
          },
        ],
        "thinking",
        CWD,
      ),
    ).toBe("agent · lit a.ts");
  });

  it("falls back on what the request does, as the mod's spinner", () => {
    expect(liveStep([], "thinking", CWD)).toBe("réfléchit");
    expect(liveStep([], "responding", CWD)).toBe("rédige");
    expect(liveStep([], "tool-input", CWD)).toBe("prépare un outil");
    expect(liveStep([], "requesting", CWD)).toBe("attend le modèle");
    expect(liveStep([], null, CWD)).toBe("travaille");
  });
});

describe("lastStep", () => {
  const done = { text: "", isError: false };
  const series = (lastDone: boolean): ToolItem[] => [
    {
      kind: "tool",
      id: "g",
      name: "Grep",
      input: { pattern: "fiche" },
      result: done,
    },
    {
      kind: "tool",
      id: "b",
      name: "Bash",
      input: { command: "rg fiche", description: "Chercher le code" },
      result: lastDone ? done : undefined,
    },
  ];

  it("says nothing while a call of the series runs: the live line does", () => {
    expect(lastStep(series(false), CWD)).toBe("");
  });

  it("names the series' last call once it is done", () => {
    expect(lastStep(series(true), CWD)).toBe("chercher le code");
    // A past call without a result (`stale`) is not running.
    const stale = series(false).map((t) => ({ ...t, stale: true }));
    expect(lastStep(stale, CWD)).toBe("chercher le code");
  });
});

describe("live line's time", () => {
  const call = (id: string, agent: boolean, startedAt: number): LiveTool => ({
    id,
    name: agent ? "Read" : "Agent",
    input: {},
    agent,
    startedAt,
  });

  it("times the main loop's call, a foreground subagent's Agent call", () => {
    const agentCall = call("a", false, 100);
    expect(timedCall([agentCall, call("r", true, 900)])).toBe(agentCall);
    const subagentOnly = call("r", true, 900);
    expect(timedCall([subagentOnly])).toBe(subagentOnly);
    expect(timedCall([])).toBeUndefined();
  });

  it("shows one time: the running call's once it lasts, else the turn's", () => {
    const now = 60_000;
    expect(liveElapsed(now, 10_000, now - STEP_TIME_MS)).toEqual({
      ms: STEP_TIME_MS,
      call: true,
    });
    // A quick call doesn't flicker the turn's time.
    expect(liveElapsed(now, 10_000, now - STEP_TIME_MS + 1)).toEqual({
      ms: 50_000,
      call: false,
    });
    expect(liveElapsed(now, 10_000, null)).toEqual({
      ms: 50_000,
      call: false,
    });
    expect(liveElapsed(now, null, null)).toBeNull();
  });
});

describe("turnDoneLine", () => {
  const endedAt = new Date(2026, 9, 31, 21, 56).getTime();

  it("closes a long turn with its time and the files it changed, never its tools", () => {
    expect(
      turnDoneLine({ durationMs: 962_000, endedAt, tools: 5, files: 2 }, false),
    ).toBe("✻ Terminé en 16 min 02 s · 21:56 · 2 fichiers modifiés");
    expect(
      turnDoneLine(
        { durationMs: LONG_TURN_MS, endedAt, tools: 1, files: 0 },
        false,
      ),
    ).toBe("✻ Terminé en 10 min 00 s · 21:56");
  });

  it("draws nothing for a short turn, nor with « Messages seuls » on", () => {
    const turn = { durationMs: LONG_TURN_MS - 1, endedAt, tools: 3, files: 1 };
    expect(turnDoneLine(turn, false)).toBeNull();
    expect(turnDoneLine({ ...turn, durationMs: 3_600_000 }, true)).toBeNull();
  });
});
