import { describe, expect, it } from "vitest";
import {
  coldFacts,
  conversationDigest,
  conversationWords,
  handoffBlock,
  handoffDue,
  handoffSummary,
  mayHandOff,
  readHandoffBlock,
  recentExchanges,
  writtenHandoff,
  type Entry,
} from "../../../chat-server/handoff.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-11-03T10:00:00Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

/** Claude's request at `ms`, its context `tokens`, its cache written for `ttl`. */
const request = (
  ms: number,
  tokens: number,
  ttl: "5m" | "1h" | "none" = "1h",
): Entry => ({
  type: "assistant",
  timestamp: at(ms),
  message: {
    content: [{ type: "text", text: "ok" }],
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: tokens - 1_010,
      cache_creation_input_tokens: 1_000,
      cache_creation:
        ttl === "none"
          ? {}
          : ttl === "1h"
            ? { ephemeral_1h_input_tokens: 1_000 }
            : { ephemeral_5m_input_tokens: 1_000 },
    },
  },
});
const user = (text: unknown, extra: Partial<Entry> = {}): Entry => ({
  type: "user",
  timestamp: at(0),
  message: { content: text },
  ...extra,
});
const claude = (...blocks: unknown[]): Entry => ({
  type: "assistant",
  timestamp: at(0),
  message: { content: blocks },
});

describe("when a session's next message goes to a handoff (chat-server/handoff.ts)", () => {
  it("is due once a big session's 1 h cache expired, not before", () => {
    const facts = coldFacts([request(0, 520_000)]);
    expect(facts).toEqual({ tokens: 520_000, at: T0, ttlMs: 60 * MIN });
    expect(handoffDue(facts, T0 + 59 * MIN)).toBe(false);
    expect(handoffDue(facts, T0 + 61 * MIN)).toBe(true);
  });

  it("leaves a session under 300 k alone", () => {
    expect(
      handoffDue(coldFacts([request(0, 299_000)]), T0 + 5 * 60 * MIN),
    ).toBe(false);
  });

  it("takes a 5 min cache's life from its writes, kept by a request that wrote nothing", () => {
    const facts = coldFacts([
      request(0, 400_000, "5m"),
      request(MIN, 410_000, "none"),
    ]);
    expect(facts?.ttlMs).toBe(5 * MIN);
    expect(handoffDue(facts, T0 + 7 * MIN)).toBe(true);
  });

  it("goes by a compaction after the last request: a small context", () => {
    const boundary: Entry = {
      type: "system",
      subtype: "compact_boundary",
      timestamp: at(30 * MIN),
      compactMetadata: { postTokens: 30_000 },
    };
    expect(coldFacts([request(0, 900_000), boundary])?.tokens).toBe(30_000);
  });

  it("ignores a subagent's requests", () => {
    const side = { ...request(10 * MIN, 900_000), isSidechain: true };
    expect(coldFacts([request(0, 100_000), side])?.tokens).toBe(100_000);
  });
});

describe("the words a handoff is written from", () => {
  it("keeps the user's prompts and Claude's replies, no tool, note nor thinking", () => {
    const said = conversationWords([
      user("Corrige le bug du prix"),
      claude(
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "Je regarde." },
      ),
      claude({
        type: "tool_use",
        id: "t1",
        name: "Read",
        input: { file_path: "a.ts" },
      }),
      user([
        { type: "tool_result", tool_use_id: "t1", content: "secret file" },
      ]),
      claude({ type: "text", text: "Corrigé." }),
      user("<command-name>/usage</command-name>"),
      user("rappel", { isMeta: true }),
    ]);
    expect(said).toEqual([
      { who: "user", text: "Corrige le bug du prix" },
      { who: "claude", text: "Je regarde.\n\nCorrigé." },
    ]);
  });

  it("starts at the last compaction, its summary first, and keeps a previous handoff", () => {
    const said = conversationWords([
      user("avant"),
      { type: "system", subtype: "compact_boundary", timestamp: at(0) },
      user("Résumé : on corrigeait le prix", { isCompactSummary: true }),
      user([
        {
          type: "text",
          text: '<arkadia-handoff from="x" tokens="1">…</arkadia-handoff>',
        },
        { type: "text", text: "suite" },
      ]),
    ]);
    expect(said.map((s) => s.who)).toEqual(["summary", "summary", "user"]);
  });

  it("past its limit, keeps the first turn and the latest ones", () => {
    const entries = [
      user("LE BUT"),
      ...Array.from(
        { length: 50 },
        (_, i) => claude({ type: "text", text: `réponse ${i} `.repeat(20) }),
        user("relance"),
      ),
      user("LA FIN"),
    ].flat();
    const text = conversationDigest(entries, 2_000);
    expect(text.length).toBeLessThanOrEqual(2_000);
    expect(text).toContain("LE BUT");
    expect(text).toContain("LA FIN");
    expect(text).toContain("le milieu de la conversation est coupé");
  });
});

describe("the digest the handoff is written from (as Claude Code's compaction reads)", () => {
  it("keeps the words whole, a call in a line, a code change's new code and a tool's error, never an output", () => {
    const digest = conversationDigest([
      user("Corrige le prix"),
      claude(
        { type: "text", text: "Je corrige." },
        {
          type: "tool_use",
          id: "r",
          name: "Read",
          input: { file_path: "src/price.ts" },
        },
        {
          type: "tool_use",
          id: "e",
          name: "Edit",
          input: {
            file_path: "src/price.ts",
            old_string: "a",
            new_string: "const price = 1;",
          },
        },
        {
          type: "tool_use",
          id: "b",
          name: "Bash",
          input: { command: "npm test" },
        },
      ),
      user([
        {
          type: "tool_result",
          tool_use_id: "r",
          content: "SECRET FILE CONTENT",
        },
        { type: "tool_result", tool_use_id: "e", content: "ok" },
        {
          type: "tool_result",
          tool_use_id: "b",
          content: "1 test failed: price",
          is_error: true,
        },
      ]),
    ]);
    expect(digest).toContain("### Alexis\nCorrige le prix");
    expect(digest).toContain("### Claude\nJe corrige.");
    expect(digest).toContain("→ Read · src/price.ts");
    expect(digest).toContain(
      "→ Edit · src/price.ts\n```\nconst price = 1;\n```",
    );
    expect(digest).toContain("✗ erreur : 1 test failed: price");
    expect(digest).not.toContain("SECRET FILE CONTENT");
  });
});

describe("the handoff block", () => {
  it("is read back by the page: the old session, its size, the summary", () => {
    const info = {
      from: "old-id",
      before: 512_000,
      summary: "## But\n- le prix",
    };
    const block = handoffBlock(info, "C:/t.jsonl", "C:/transcript.ts");
    expect(readHandoffBlock(block)).toEqual(info);
    expect(block).toContain('node "C:/transcript.ts" show "C:/t.jsonl" <n>');
    expect(readHandoffBlock("un message ordinaire")).toBeNull();
  });

  it("ends with the 10 latest exchanges, quoted as is", () => {
    const said = Array.from({ length: 12 }, (_, i) => [
      { who: "user" as const, text: `question ${i}` },
      { who: "claude" as const, text: `réponse ${i}` },
    ]).flat();
    const summary = handoffSummary("1. Demande principale", said);
    expect(summary).toContain("## Derniers échanges (mot pour mot)");
    expect(summary).toContain("**Alexis** : question 2");
    expect(summary).toContain("**Claude** : réponse 11");
    expect(summary).not.toContain("question 1\n");
    expect(summary).not.toContain("**Alexis** : question 1\n");
  });

  it("keeps a very long message's start only", () => {
    const recent = recentExchanges([{ who: "user", text: "x".repeat(10_000) }]);
    expect(recent.length).toBeLessThan(4_100);
  });
});

describe("what Opus answered", () => {
  it("is the handoff only when its request succeeded", () => {
    expect(writtenHandoff({ subtype: "success", result: " ## But " })).toBe(
      "## But",
    );
    // Claude Code's compaction format: the summary inside its tags.
    expect(
      writtenHandoff({
        subtype: "success",
        result: "<summary>\n1. Demande\n</summary>",
      }),
    ).toBe("1. Demande");
    // A refused request ends « success » too, its error as the text.
    const limit = {
      subtype: "success",
      is_error: true,
      result: "You've hit your 5-hour limit",
    };
    expect(() => writtenHandoff(limit)).toThrow("5-hour limit");
    expect(() => writtenHandoff({ subtype: "success", result: "  " })).toThrow(
      "passation vide",
    );
    expect(() => writtenHandoff({ subtype: "error_max_turns" })).toThrow(
      "error_max_turns",
    );
  });
});

describe("what may open a handoff, before the transcript is read", () => {
  it("a message after 5 min, never a slash command, a resume « en entier » nor a rewind", () => {
    expect(mayHandOff("On attaque l'export", false, false, 6 * MIN)).toBe(true);
    expect(mayHandOff("On attaque l'export", false, false, 4 * MIN)).toBe(
      false,
    );
    expect(mayHandOff("  /compact", false, false, 90 * MIN)).toBe(false);
    expect(mayHandOff("/usage", false, false, 90 * MIN)).toBe(false);
    expect(mayHandOff("suite", true, false, 90 * MIN)).toBe(false);
    expect(mayHandOff("suite", false, true, 90 * MIN)).toBe(false);
  });
});

describe("odd texts around a handoff (review of 03/11/2026)", () => {
  it("keeps a summary that quotes its own tags whole", () => {
    const result =
      "<summary>\n3. Fichiers : `writerPrompt` demande <summary></summary>.\n9. Suite\n</summary>";
    expect(writtenHandoff({ subtype: "success", result })).toContain(
      "9. Suite",
    );
    const info = {
      from: "o",
      before: 400_000,
      summary: "cite </passation> puis la suite",
    };
    expect(
      readHandoffBlock(handoffBlock(info, "t.jsonl", "tool.ts"))?.summary,
    ).toBe(info.summary);
  });

  it("keeps the start of a last message too long for the budget", () => {
    const digest = conversationDigest(
      [
        user("LE BUT"),
        claude({ type: "text", text: "ok" }),
        user(`LOG ${"x".repeat(5_000)}`),
      ],
      2_000,
    );
    expect(digest).toContain("LOG xxx");
  });

  it("counts a message of two blocks once, never Claude Code's interruption mark", () => {
    const said = conversationWords([
      user([
        { type: "text", text: "première partie" },
        { type: "text", text: "seconde partie" },
      ]),
      user("[Request interrupted by user]"),
    ]);
    expect(said).toEqual([
      { who: "user", text: "première partie\nseconde partie" },
    ]);
  });
});
