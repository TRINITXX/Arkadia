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
    expect(rows.map((r) => r.key)).toEqual(["end", "activity:b1", "step", "u"]);
    // A reply followed by work is a step; the turn's last one is its answer.
    expect(rows.map((r) => r.step)).toEqual([false, false, true, false]);
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
    const rows = feedRows([user("u", yesterday), text("a", now)], false, now);
    expect(
      rows.map((r) => (r.unit.kind === "day" ? r.unit.label : r.key)),
    ).toEqual(["a", "Aujourd'hui", "u", "Hier"]);
  });
});

describe("sameRow", () => {
  it("is the same row while its items are, rebuilt or not", () => {
    const items = [user("u"), tool("Bash", "b1"), tool("Read", "r1")];
    const before = feedRows(items, true);
    const after = feedRows([...items, text("new")], true);
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
