import { describe, expect, it } from "vitest";
import type { SlashCommandInfo } from "@/lib/chat/chatProtocol";
import {
  markLive,
  menuCommands,
  needsArgs,
  OPEN_ELSEWHERE,
  parseSlash,
  refusedCommand,
  resumeRefusal,
  rewindRows,
  sessionRows,
  slashEntries,
  slashHead,
  whenLabel,
} from "@/lib/chat/chatSlash";

const cmd = (
  name: string,
  extra: Partial<SlashCommandInfo> = {},
): SlashCommandInfo => ({ name, description: "", argumentHint: "", ...extra });

const LISTED = [
  cmd("superpowers:brainstorming"),
  cmd("commit"),
  cmd("usage", { builtin: true, aliases: ["cost", "stats"] }),
  cmd("compact", { builtin: true }),
  cmd("context", { builtin: true }),
  cmd("__remote-workflow", { builtin: true }),
];

describe("the / menu", () => {
  const all = menuCommands(LISTED, []);

  it("lists built-ins, then the user's commands, then plugins, internals left out", () => {
    const entries = slashEntries(all, "");
    expect(entries.map((e) => e.group)).toEqual([
      "builtin",
      "builtin",
      "builtin",
      "builtin",
      "builtin",
      "user",
      "plugin",
    ]);
    expect(entries.map((e) => e.command.name)).not.toContain(
      "__remote-workflow",
    );
    expect(entries.map((e) => e.command.name)).toContain("resume");
  });

  it("filters on names and aliases, the closest first", () => {
    expect(slashEntries(all, "cost").map((e) => e.command.name)).toEqual([
      "usage",
    ]);
    expect(slashEntries(all, "co").map((e) => e.command.name)).toEqual([
      "compact",
      "context",
      "usage",
      "commit",
    ]);
    expect(slashEntries(all, "brain").map((e) => e.command.name)).toEqual([
      "superpowers:brainstorming",
    ]);
  });

  it("heads the exact match pinned first apart, each group's header once", () => {
    // A skill typed in full, a built-in and another skill after it: the
    // skills' header showed twice (31/10/2026).
    const entries = slashEntries(
      menuCommands(
        [...LISTED, cmd("commit-push"), cmd("commit-msg", { builtin: true })],
        [],
      ),
      "commit",
    );
    expect(entries.map((e) => e.command.name)).toEqual([
      "commit",
      "commit-msg",
      "commit-push",
    ]);
    expect(entries.map((_, i) => slashHead(entries, i))).toEqual([
      "Correspondance exacte",
      "Claude Code",
      "Tes skills et commandes",
    ]);
    const all = slashEntries(menuCommands(LISTED, []), "");
    const heads = all.map((_, i) => slashHead(all, i)).filter(Boolean);
    expect(heads).toEqual([
      "Claude Code",
      "Tes skills et commandes",
      "Plugins et MCP",
    ]);
  });

  it("falls back on the init's names before the full list", () => {
    const names = menuCommands([], ["context"]).map((c) => c.name);
    expect(names).toEqual(["resume", "rewind", "context"]);
  });

  it("runs a command on Enter unless it needs arguments", () => {
    expect(needsArgs("")).toBe(false);
    expect(needsArgs("[name]")).toBe(false);
    expect(needsArgs("<optional custom summarization instructions>")).toBe(
      false,
    );
    expect(needsArgs("<model>")).toBe(true);
  });

  it("reads a command, not a path", () => {
    expect(parseSlash("/compact keep it short")).toEqual({
      name: "compact",
      args: "keep it short",
    });
    expect(parseSlash("/tmp/x is big")).toBeNull();
    expect(parseSlash("hello /context")).toBeNull();
  });

  it("knows Claude Code's refusal of a terminal-only command", () => {
    expect(refusedCommand("/status isn't available in this environment.")).toBe(
      "status",
    );
    expect(refusedCommand("Session renamed to: x")).toBeNull();
  });
});

describe("the /resume and /rewind panels", () => {
  const now = new Date(2026, 9, 31, 15, 0).getTime();

  it("lists the folder's sessions newest first, this one and those open elsewhere not to be taken", () => {
    const rows = sessionRows(
      [
        {
          sessionId: "a",
          title: "Ancienne",
          lastModified: now - 3 * 86_400_000,
        },
        { sessionId: "b", title: "En cours", lastModified: now - 60_000 },
        {
          sessionId: "c",
          title: "Ailleurs",
          lastModified: now - 3_600_000,
          open: true,
        },
      ],
      "",
      "b",
      now,
    );
    expect(rows.map((r) => [r.id, r.disabled])).toEqual([
      ["b", "en cours"],
      ["c", "ouverte ailleurs"],
      ["a", undefined],
    ]);
    // The new chat's list leaves the branch out.
    const onMain = {
      sessionId: "m",
      title: "M",
      lastModified: now,
      gitBranch: "main",
    };
    expect(sessionRows([onMain], "", null, now)[0].meta).toContain("main");
    expect(
      sessionRows([onMain], "", null, now, { branch: false })[0].meta,
    ).not.toContain("main");
    expect(
      sessionRows(
        rows.map((r) => ({ sessionId: r.id, title: r.title, lastModified: 0 })),
        "anc",
        null,
        now,
      ),
    ).toHaveLength(1);
  });

  it("lists the user's messages newest first, by their first line", () => {
    const rows = rewindRows(
      [
        {
          uuid: "1",
          text: "Premier message\nsuite",
          timestamp: "2026-10-31T10:00:00Z",
        },
        { uuid: "2", text: "Second" },
      ],
      "",
      now,
    );
    expect(rows.map((r) => [r.id, r.title])).toEqual([
      ["2", "Second"],
      ["1", "Premier message"],
    ]);
  });

  it("dates a row as the terminal's pickers do", () => {
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 5).getTime();
    expect(whenLabel(at(31, 9), now)).toBe("09:05");
    expect(whenLabel(at(30, 9), now)).toBe("hier 09:05");
    expect(whenLabel(at(12, 9), now)).toMatch(/^12 oct/);
  });

  it("keeps a session running in another pane from /resume", () => {
    const sessions = [
      { sessionId: "term", title: "Dans un terminal", lastModified: 2 },
      { sessionId: "free", title: "Libre", lastModified: 1 },
    ];
    const rows = sessionRows(
      markLive(sessions, new Set(["term"])),
      "",
      null,
      now,
    );
    expect(rows.map((r) => [r.id, r.disabled])).toEqual([
      ["term", "ouverte ailleurs"],
      ["free", undefined],
    ]);
  });

  it("refuses at the choice a session opened elsewhere since the panel showed", () => {
    const sessions = [
      { sessionId: "chat", title: "Autre chat", lastModified: 2, open: true },
      { sessionId: "free", title: "Libre", lastModified: 1 },
    ];
    expect(resumeRefusal(sessions, new Set(["term"]), "term")).toBe(
      OPEN_ELSEWHERE,
    );
    expect(resumeRefusal(sessions, new Set(), "chat")).toBe(OPEN_ELSEWHERE);
    expect(resumeRefusal(sessions, new Set(["term"]), "free")).toBeNull();
  });
});

describe("the name typed in full", () => {
  it("comes first whatever its group: Enter on /m runs /m, not /mcp", () => {
    const all = menuCommands(
      [
        cmd("mcp", { builtin: true }),
        cmd("model", { builtin: true }),
        cmd("m"),
        cmd("superpowers:m-plugin"),
      ],
      [],
    );
    const entries = slashEntries(all, "m");
    expect(entries.map((e) => e.command.name)).toEqual([
      "m",
      "mcp",
      "model",
      "superpowers:m-plugin",
    ]);
    expect(entries.map((e) => e.group)).toEqual([
      "user",
      "builtin",
      "builtin",
      "plugin",
    ]);
  });
});
