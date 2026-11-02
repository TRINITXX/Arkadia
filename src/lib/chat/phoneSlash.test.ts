import { describe, expect, it } from "vitest";
import type { SlashCommandInfo } from "@/lib/chat/chatProtocol";
import { mcpRows, terminalOnlyNotice } from "@/lib/chat/chatSlash";
import {
  mcpRowView,
  mcpTapAction,
  phoneSlashMenu,
  slashIntent,
  slashPick,
} from "@/lib/chat/phoneSlash";

const cmd = (
  name: string,
  extra: Partial<SlashCommandInfo> = {},
): SlashCommandInfo => ({ name, description: "", argumentHint: "", ...extra });

const LISTED = [
  cmd("compact", { builtin: true }),
  cmd("commit"),
  cmd("status", { builtin: true }),
];

describe("the phone's / menu", () => {
  it("lists the page's commands with Claude Code's, headers on each section's first row", () => {
    const rows = phoneSlashMenu("/", LISTED, []);
    expect(rows.map((r) => r.entry.command.name)).toEqual([
      "compact",
      "mcp",
      "resume",
      "rewind",
      "status",
      "commit",
    ]);
    expect(rows.map((r) => r.head)).toEqual([
      "Claude Code",
      null,
      null,
      null,
      null,
      "Tes skills et commandes",
    ]);
  });

  it("closes once a space follows the name", () => {
    expect(
      phoneSlashMenu("/re", LISTED, []).map((r) => r.entry.command.name),
    ).toEqual(["resume", "rewind"]);
    expect(phoneSlashMenu("/resume ", LISTED, [])).toEqual([]);
    expect(phoneSlashMenu("salut", LISTED, [])).toEqual([]);
  });
});

describe("slashIntent", () => {
  it("opens a page command's sheet, its words as the filter", () => {
    expect(slashIntent("/rewind  ajoute le test", LISTED, [])).toEqual({
      kind: "panel",
      panel: "rewind",
      query: "ajoute le test",
    });
  });

  it("answers a terminal-only built-in Claude Code doesn't list", () => {
    expect(slashIntent("/help", LISTED, [])).toEqual({
      kind: "notice",
      text: terminalOnlyNotice("help"),
    });
    // Listed (here, or by name alone): it goes to Claude.
    expect(slashIntent("/status", LISTED, [])).toBeNull();
    expect(slashIntent("/help", [], ["help"])).toBeNull();
  });

  it("sends anything else, a path included", () => {
    expect(slashIntent("/compact", LISTED, [])).toBeNull();
    expect(slashIntent("/tmp/x est vide", LISTED, [])).toBeNull();
  });
});

describe("slashPick", () => {
  it("opens a page command's sheet, types any other for its arguments", () => {
    const [mcp] = phoneSlashMenu("/mcp", LISTED, []);
    expect(slashPick(mcp.entry)).toEqual({ kind: "panel", panel: "mcp" });
    const [compact] = phoneSlashMenu("/compact", LISTED, []);
    expect(slashPick(compact.entry)).toEqual({
      kind: "type",
      text: "/compact ",
    });
  });
});

describe("a /mcp row", () => {
  const rows = mcpRows(
    [
      { name: "github", status: "needs-auth", source: "user" },
      { name: "exa", status: "connected", source: "user" },
      { name: "sentry", status: "failed", source: "user", error: "timeout" },
    ],
    "",
  );
  const row = (name: string) => rows.find((r) => r.id === name)!;

  it("shows its button, its switch, its error", () => {
    expect(mcpRowView(row("github"), undefined)).toMatchObject({
      button: "Se connecter",
      switchOn: null,
      busy: null,
    });
    expect(mcpRowView(row("exa"), undefined)).toMatchObject({
      button: null,
      switchOn: true,
    });
    expect(mcpRowView(row("sentry"), undefined)).toMatchObject({
      button: "Reconnecter",
      error: "timeout",
    });
  });

  it("says its action under way, the error of its last over the server's", () => {
    const signin = { state: "signin", status: "needs-auth" } as const;
    expect(mcpRowView(row("github"), signin).busy).toBe("ouvert sur le PC…");
    expect(
      mcpRowView(row("sentry"), { error: "refusé", status: "failed" }).error,
    ).toBe("refusé");
  });

  it("takes no tap while its question is asked, a sign-in can be asked again", () => {
    const asking = { state: "asking", status: "needs-auth" } as const;
    expect(mcpTapAction(row("github"), false, asking)).toBeNull();
    expect(
      mcpTapAction(row("github"), false, {
        state: "signin",
        status: "needs-auth",
      }),
    ).toBe("connect");
    expect(mcpTapAction(row("exa"), true, undefined)).toBe("disable");
    expect(mcpTapAction(row("exa"), false, undefined)).toBeNull();
  });
});
