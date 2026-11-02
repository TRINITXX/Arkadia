import { describe, expect, it } from "vitest";
import { foldActivity, groupChatItems } from "@/lib/chat/chatGroups";
import type { ChatItem } from "@/lib/chat/chatState";
import { placeWork } from "@/lib/chat/chatWorkPlaces";

const user = (
  id: string,
  state: { queued?: boolean; dropped?: boolean } = {},
): ChatItem => ({
  kind: "user",
  id,
  text: id,
  images: 0,
  ...state,
});
const think = (id: string): ChatItem => ({
  kind: "thinking",
  id,
  text: `pensée ${id}`,
  streaming: false,
});
const say = (id: string): ChatItem => ({
  kind: "text",
  id,
  text: id,
  streaming: false,
});
const run = (id: string): ChatItem => ({
  kind: "tool",
  id,
  name: "Bash",
  input: { command: "ls" },
});
const units = (items: ChatItem[]) => foldActivity(groupChatItems(items));
const ids = (items: { id: string }[] | undefined) => items?.map((i) => i.id);
const toolIds = (places: ReturnType<typeof placeWork>, reply: string) =>
  places.tools
    .get(reply)
    ?.flatMap((u) => (u.kind === "work" ? u.tools : [u.item]))
    .map((t) => t.id);

describe("placeWork", () => {
  it("puts each thought behind the reply it led to", () => {
    const places = placeWork(
      units([
        user("u"),
        think("t1"),
        run("b1"),
        say("s1"),
        think("t2"),
        run("b2"),
        say("answer"),
      ]),
      false,
    );
    expect(ids(places.thoughts.get("s1"))).toEqual(["t1"]);
    expect(ids(places.thoughts.get("answer"))).toEqual(["t2"]);
    expect(places.live).toBeNull();
  });

  it("puts tools behind the reply that announced them, before any reply the first one's", () => {
    const places = placeWork(
      units([user("u"), run("b1"), say("s1"), run("b2"), say("answer")]),
      false,
    );
    expect(toolIds(places, "s1")).toEqual(["b1", "b2"]);
    expect(places.tools.has("answer")).toBe(false);
  });

  it("shows the latest thought no reply follows yet while Claude works", () => {
    const shown = units([
      user("u"),
      say("s1"),
      think("t1"),
      run("b1"),
      think("t2"),
      run("b2"),
    ]);
    const places = placeWork(shown, true);
    expect(places.live).toBe(shown.find((u) => u.kind === "thoughts")?.id);
    // Once the turn ends without another reply: behind the last one.
    expect(ids(placeWork(shown, false).thoughts.get("s1"))).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("keeps the exchange under way in view until the user's next message", () => {
    const shown = units([
      user("u1"),
      say("old"),
      run("b1"),
      user("u2"),
      say("new"),
      run("b2"),
      { kind: "turn", id: "end", durationMs: 1, tools: 1, files: 0 },
    ]);
    const places = placeWork(shown, false);
    const lines = shown.filter((u) => u.kind === "activity").map((u) => u.id);
    expect(places.current.has("new")).toBe(true);
    expect(places.current.has(lines[1])).toBe(true);
    expect(places.current.has("old")).toBe(false);
    expect(places.current.has(lines[0])).toBe(false);
  });

  it("lets a message still waiting not cut what Claude is doing", () => {
    const shown = units([
      user("u"),
      say("s1"),
      user("q", { queued: true }),
      think("t1"),
    ]);
    const places = placeWork(shown, true);
    expect(places.live).not.toBeNull();
    expect([...places.current]).toEqual(["s1"]);
  });

  it("lets a message never taken not open an exchange", () => {
    const shown = units([
      user("u"),
      say("s1"),
      run("b1"),
      user("q", { dropped: true }),
    ]);
    const places = placeWork(shown, false);
    expect(places.current.has("s1")).toBe(true);
  });

  it("gives work with no reply in its exchange an icon of its own", () => {
    const shown = units([user("u1"), think("t1"), run("b1"), user("u2")]);
    const places = placeWork(shown, false);
    expect(places.alone.size).toBe(2);
    expect(places.thoughts.size).toBe(0);
    expect(places.tools.size).toBe(0);
  });
});
