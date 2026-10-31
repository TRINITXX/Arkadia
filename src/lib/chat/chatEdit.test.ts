import { describe, expect, it } from "vitest";
import { editBlocked, laterMessages, rewindPointOf } from "@/lib/chat/chatEdit";
import type { ChatItem } from "@/lib/chat/chatState";

const user = (id: string, text: string) =>
  ({ kind: "user", id, text, images: 0 }) as Extract<
    ChatItem,
    { kind: "user" }
  >;
const reply = (id: string): ChatItem => ({
  kind: "text",
  id,
  text: "ok",
  streaming: false,
});

describe("editing one of my messages", () => {
  const first = user("sent:aaa", "continue");
  const second = user("sent:bbb", "continue");
  const items: ChatItem[] = [first, reply("r1"), second, reply("r2")];

  it("counts the messages it drops", () => {
    expect(laterMessages(items, first)).toBe(3);
    expect(laterMessages(items, second)).toBe(1);
  });

  it("finds its rewind point by uuid, else by text from the end", () => {
    const points = [
      { uuid: "t1", text: "continue" },
      { uuid: "t2", text: "continue" },
    ];
    expect(rewindPointOf(items, first, points)?.uuid).toBe("t1");
    expect(rewindPointOf(items, second, points)?.uuid).toBe("t2");
    expect(
      rewindPointOf(items, second, [...points, { uuid: "bbb", text: "x" }])
        ?.uuid,
    ).toBe("bbb");
    expect(rewindPointOf(items, first, [])).toBeNull();
  });
});

describe("editBlocked", () => {
  const rest = { working: false, closed: null, request: false, going: false };

  it("lets the pencil act only at rest, and says why not otherwise", () => {
    expect(editBlocked(rest)).toBeNull();
    expect(editBlocked({ ...rest, working: true })).toMatch(/Claude travaille/);
    expect(editBlocked({ ...rest, request: true })).toMatch(/demande/);
    expect(editBlocked({ ...rest, closed: { error: null } })).toMatch(
      /arrêtée/,
    );
  });
});
