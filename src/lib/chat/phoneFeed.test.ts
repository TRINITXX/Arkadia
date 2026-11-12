import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/chatState";
import {
  bashServerId,
  feedRows,
  sameRow,
  sentUuid,
} from "@/lib/chat/phoneFeed";

const tool = (name: string, id: string, at?: number): ChatItem => ({
  kind: "tool",
  id,
  name,
  input: { command: "ls" },
  at,
});
const text = (id: string, at?: number): ChatItem => ({
  kind: "text",
  id,
  text: id,
  streaming: false,
  at,
});
const user = (id: string, at?: number): ChatItem => ({
  kind: "user",
  id,
  text: id,
  images: 0,
  at,
});
const think = (id: string): ChatItem => ({
  kind: "thinking",
  id,
  text: `pensée ${id}`,
  streaming: false,
});

describe("feedRows", () => {
  it("gives the column's units newest first, the work folded into one row", () => {
    const rows = feedRows(
      [
        user("u"),
        text("step"),
        tool("Bash", "b1"),
        tool("Read", "r1"),
        text("end"),
      ],
      false,
    );
    // The turn over, its work goes behind the wrench of the reply before it.
    expect(rows.map((r) => r.key)).toEqual(["end", "step", "u"]);
    expect(rows.find((r) => r.key === "step")?.tools?.length).toBe(1);
    // A reply followed by work is a step; the turn's last one is its answer.
    expect(rows.map((r) => r.step)).toEqual([false, true, false]);
  });

  it("leaves out a short turn's line and a thinking with no words", () => {
    const rows = feedRows(
      [
        text("a"),
        { kind: "thinking", id: "th", text: "   ", streaming: false },
        { kind: "turn", id: "t1", durationMs: 5_000, tools: 1, files: 0 },
        {
          kind: "turn",
          id: "t2",
          durationMs: 11 * 60_000,
          tools: 2,
          files: 1,
          at: Date.now(),
        },
      ],
      false,
    );
    expect(rows.map((r) => r.key)).toEqual(["t2", "a"]);
    expect(rows[0].turn).toMatch(
      /^✻ Terminé en 11 min 00 s · \d\d:\d\d · 1 fichier modifié$/,
    );
  });

  it("marks the day before its first row", () => {
    const now = new Date(2026, 10, 2, 12).getTime();
    const yesterday = new Date(2026, 10, 1, 9).getTime();
    const rows = feedRows([user("u", yesterday), text("a", now)], false, {
      now,
    });
    expect(
      rows.map((r) => (r.unit.kind === "day" ? r.unit.label : r.key)),
    ).toEqual(["a", "Aujourd'hui", "u", "Hier"]);
  });
});

describe("feedRows « Récit »", () => {
  it("puts thinking behind the reply it led to, past tools behind a wrench", () => {
    const rows = feedRows(
      [
        user("u1"),
        think("t1"),
        text("s1"),
        tool("Bash", "b1"),
        text("answer"),
        user("u2"),
        text("now"),
        tool("Bash", "b2"),
      ],
      false,
    );
    const row = (key: string) => rows.find((r) => r.key === key);
    // The thinking and the tools leave the feed…
    expect(rows.map((r) => r.key)).toEqual(["now", "u2", "answer", "s1", "u1"]);
    // …for the icons of the replies they belong to.
    expect(row("s1")?.thoughts?.map((t) => t.id)).toEqual(["t1"]);
    expect(row("s1")?.tools?.length).toBe(1);
    expect(row("s1")?.past).toBe(true);
    // The exchange under way's too, its reply in full ink.
    expect(row("now")?.tools?.length).toBe(1);
    expect(row("now")?.past).toBe(false);
    // While Claude works, the line under way shows: no wrench for it.
    const live = feedRows([user("u2"), text("now"), tool("Bash", "b2")], true);
    expect(live.map((r) => r.key)).toEqual(["activity:b2", "now", "u2"]);
    expect(live.find((r) => r.key === "now")?.tools).toBeNull();
  });

  it("shows the latest thought in full while Claude works, else its own bulb", () => {
    const items = [user("u"), think("t1")];
    const live = feedRows(items, true);
    expect(live[0].unit.kind).toBe("thoughts");
    expect(live[0].alone).toBe(false);
    expect(feedRows(items, false)[0].alone).toBe(true);
  });
});

describe("feedRows of a subagent's sheet", () => {
  it("gives each thought and each run of tools a row, in order", () => {
    // A subagent at work: thinking and tools, no reply before its report.
    const items = [
      user("u"),
      think("t1"),
      tool("Read", "r1"),
      tool("Grep", "g1"),
      think("t2"),
      tool("Bash", "b1"),
    ];
    const rows = feedRows(items, true, { unfolded: true });
    expect(rows.map((r) => r.key)).toEqual(["b1", "t2", "r1", "t1", "u"]);
    expect(rows.map((r) => r.unit.kind)).toEqual([
      "work",
      "thinking",
      "work",
      "thinking",
      "user",
    ]);
    // None behind an icon: all in full.
    expect(rows.some((r) => r.alone)).toBe(false);
    // The chat's own feed: its latest thought and one line of counts.
    expect(feedRows(items, true).map((r) => r.unit.kind)).toEqual([
      "activity",
      "thoughts",
      "user",
    ]);
  });
});

describe("feedRows « Messages seuls »", () => {
  it("keeps the words and drops the work, thinking and « Terminé en »", () => {
    const rows = feedRows(
      [
        user("u"),
        think("t1"),
        tool("Bash", "b1"),
        text("a"),
        {
          kind: "turn",
          id: "t",
          durationMs: 11 * 60_000,
          tools: 1,
          files: 0,
          at: Date.now(),
        },
      ],
      false,
      { messagesOnly: true },
    );
    expect(rows.map((r) => r.key)).toEqual(["a", "u"]);
    // Its thinking went with the work: no bulb to open.
    expect(rows[0].thoughts).toBeNull();
  });
});

describe("sameRow", () => {
  it("is the same row while its items are, rebuilt or not", () => {
    const items = [user("u"), tool("Bash", "b1"), tool("Read", "r1")];
    const before = feedRows(items, true);
    // A message typed meanwhile, waiting: the line under way stays.
    const queued: ChatItem = { ...user("q"), queued: true } as ChatItem;
    const after = feedRows([...items, queued], true);
    expect(sameRow(before[0], after[1])).toBe(true);
    // A tool's result came: its row draws again.
    const done = items.map((i) =>
      i.id === "r1" ? { ...i, result: { text: "x", isError: false } } : i,
    );
    expect(sameRow(before[0], feedRows(done, true)[0])).toBe(false);
  });
});

describe("ids", () => {
  it("reads the server's ids of a queued message and a `!` command", () => {
    expect(sentUuid("sent:abc")).toBe("abc");
    expect(sentUuid("u1")).toBeNull();
    expect(bashServerId("bash:42")).toBe("42");
    expect(bashServerId("x")).toBeNull();
  });
});
