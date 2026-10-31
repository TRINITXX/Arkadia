import { describe, expect, it } from "vitest";
import { recallStep, sentHistory } from "@/lib/chat/chatInputHistory";
import type { ChatItem } from "@/lib/chat/chatState";

const user = (id: string, text: string): ChatItem => ({
  kind: "user",
  id,
  text,
  images: 0,
});

describe("↑ recalls the user's messages", () => {
  it("lists them newest first, commands too, no repeat in a row", () => {
    const items: ChatItem[] = [
      user("1", "lis le fichier"),
      { kind: "text", id: "t", text: "fait", streaming: false },
      { kind: "command", id: "c", name: "compact", args: "", absorbed: [] },
      user("2", "continue"),
      user("3", "continue"),
    ];
    expect(sentHistory(items)).toEqual([
      "continue",
      "/compact",
      "lis le fichier",
    ]);
  });

  it("steps up to the oldest, then down back to an empty input", () => {
    const h = ["b", "a"];
    expect(recallStep(h, -1, "up")).toEqual({ index: 0, text: "b" });
    expect(recallStep(h, 0, "up")).toEqual({ index: 1, text: "a" });
    expect(recallStep(h, 1, "up")).toBeNull();
    expect(recallStep(h, 1, "down")).toEqual({ index: 0, text: "b" });
    expect(recallStep(h, 0, "down")).toEqual({ index: -1, text: "" });
    expect(recallStep(h, -1, "down")).toBeNull();
  });
});
