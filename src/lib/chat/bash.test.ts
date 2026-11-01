import { describe, expect, it } from "vitest";
import {
  bangBlocks,
  ConsoleDecoder,
  entriesEnd,
  gitBash,
  groupScript,
  keep,
  keptText,
  NOTHING_KEPT,
  readPids,
  utf8Tail,
} from "../../../chat-server/bash.ts";

const kept = (text: string, room = 1_000) => keep(NOTHING_KEPT, text, room);

describe("a `!` command for Claude (chat-server/bash.ts)", () => {
  it("writes Claude Code's own entries: the command as typed, the output escaped", () => {
    const blocks = bangBlocks(
      "grep -c x a.txt && echo ok",
      kept("> 3 & <done>\n"),
      kept(""),
      false,
    );
    expect(blocks.input).toBe(
      "<bash-input>grep -c x a.txt && echo ok</bash-input>",
    );
    expect(blocks.output).toBe(
      "<bash-stdout>&gt; 3 &amp; &lt;done&gt;\n</bash-stdout><bash-stderr></bash-stderr>",
    );
  });

  it("says a silent command completed, as Claude Code does", () => {
    expect(bangBlocks("true", NOTHING_KEPT, NOTHING_KEPT, false).output).toBe(
      "<bash-stdout>(Bash completed with no output)</bash-stdout><bash-stderr></bash-stderr>",
    );
  });

  it("tells Claude a command the user stopped", () => {
    const blocks = bangBlocks(
      "ping -t x",
      kept("Réponse\n"),
      NOTHING_KEPT,
      true,
    );
    expect(blocks.output).toContain(
      "<bash-stderr>[Command stopped by the user]</bash-stderr>",
    );
  });

  it("cuts a long output to its start and end, and counts what Claude gets", () => {
    const out = "a".repeat(500) + "b".repeat(500);
    const blocks = bangBlocks(
      "cat big",
      kept(out, 400),
      NOTHING_KEPT,
      false,
      100,
    );
    expect(blocks.output).toMatch(
      /^<bash-stdout>a{50}\n… \[900 characters cut\] …\nb{50}<\/bash-stdout>/,
    );
    expect(blocks).toMatchObject({ sent: 100, total: 1_000 });
  });

  it("keeps a third of the room for the errors when both streams overflow", () => {
    const blocks = bangBlocks(
      "x",
      kept("o".repeat(300)),
      kept("e".repeat(300)),
      false,
      90,
    );
    expect(blocks.sent).toBe(90);
    expect(blocks.output).toContain(
      `${"e".repeat(15)}\n… [270 characters cut] …`,
    );
  });

  it("keeps a stream's start and its end while it runs, never all of it", () => {
    let k = NOTHING_KEPT;
    for (const chunk of ["12345", "67890", "abcde"]) k = keep(k, chunk, 4);
    expect(k).toEqual({ head: "1234", tail: "bcde", total: 15 });
    expect(keptText(k, 6)).toEqual({
      text: "123\n… [9 characters cut] …\ncde",
      cut: 9,
    });
    expect(keptText(kept("short"), 100)).toEqual({ text: "short", cut: 0 });
  });

  it("finds no Git Bash where none is installed", () => {
    expect(gitBash({ PATH: "C:\\nowhere" })).toBeNull();
  });
});

describe("a `!` command's output as it comes (chat-server/bash.ts)", () => {
  it("shows a line without end, a progress bar, at once", () => {
    const decoder = new ConsoleDecoder();
    expect(decoder.push(Buffer.from("50 %\r"))).toBe("50 %\r");
    expect(decoder.push(Buffer.from('{"minified":true}'))).toBe(
      '{"minified":true}',
    );
  });

  it("holds only a character the chunk cuts, and Windows' own bytes as OEM", () => {
    const decoder = new ConsoleDecoder();
    const e = Buffer.from("é");
    expect(utf8Tail(Uint8Array.from([0x61, e[0]]))).toBe(1);
    expect(decoder.push(Uint8Array.from([0x61, e[0]]))).toBe("a");
    expect(decoder.push(Uint8Array.from([e[1], 0x0a]))).toBe("é\n");
    // ping's « R\x82ponse » (code page 850).
    expect(decoder.push(Uint8Array.from([0x52, 0x82, 0x70]))).toBe("Rép");
  });
});

describe("a `!` command's processes (chat-server/bash.ts)", () => {
  it("finds a background job by bash's process group, its parent long gone", () => {
    expect(groupScript("4821")).toContain('[ "$g" = "4821" ]');
    expect(readPids("56788\n59388\n\n")).toEqual([56788, 59388]);
  });
});

describe("Claude Code's turn for our `!` entries (chat-server/bash.ts)", () => {
  const ours = new Set(["e1", "e2"]);

  it("swallows a turn that took only them, without the model", () => {
    const end = entriesEnd(
      { type: "result", num_turns: 0, user_message_uuids: ["e1", "e2"] },
      ours,
    );
    expect(end).toEqual({ written: ["e1", "e2"], swallow: true, taken: true });
  });

  it("leaves the user's own turn, even one that took them along", () => {
    expect(
      entriesEnd(
        { type: "result", num_turns: 0, user_message_uuids: ["cmd"] },
        ours,
      ).swallow,
    ).toBe(false);
    expect(
      entriesEnd(
        { type: "result", num_turns: 1, user_message_uuids: ["e1", "m"] },
        ours,
      ),
    ).toEqual({ written: ["e1"], swallow: false, taken: true });
  });

  it("marks one written by its completed frame", () => {
    expect(
      entriesEnd(
        { type: "command_lifecycle", command_uuid: "e2", state: "completed" },
        ours,
      ).written,
    ).toEqual(["e2"]);
    expect(
      entriesEnd(
        { type: "command_lifecycle", command_uuid: "e2", state: "started" },
        ours,
      ).written,
    ).toEqual([]);
  });
});
