import { describe, expect, it } from "vitest";
import { chatHighlightCss, chatHighlightNames } from "@/lib/chat/useChatSearch";

describe("chatHighlightNames", () => {
  it("gives each pane names of its own, apart from the reading view's", () => {
    const names = chatHighlightNames(":r1:");
    expect(names).toEqual({
      all: "chat-match-r1",
      current: "chat-match-current-r1",
    });
    expect(chatHighlightNames(":r2:").all).not.toBe(names.all);
    // useId's colons would void the selector.
    expect(chatHighlightCss(names)).toContain("::highlight(chat-match-r1) {");
  });
});
