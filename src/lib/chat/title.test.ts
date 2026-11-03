import { describe, expect, it } from "vitest";
import { sessionTitle } from "../../../chat-server/title.ts";

describe("a chat tab's title (chat-server/title.ts)", () => {
  it("takes Claude Code's title as soon as it is written, mid-turn", () => {
    const named = {
      customTitle: "Bilan du ménage",
      summary: "Bilan du ménage",
    };
    expect(sessionTitle(named, true)).toBe("Bilan du ménage");
  });

  it("never shows the prompt just sent before Claude Code names the session", () => {
    const unnamed = { summary: "regarde pourquoi le titre ne change pas" };
    expect(sessionTitle(unnamed, true)).toBeUndefined();
    // At the turn's end, as before: the prompt rather than the folder's name.
    expect(sessionTitle(unnamed, false)).toBe(
      "regarde pourquoi le titre ne change pas",
    );
  });

  it("gives no title to a session opened by a command", () => {
    expect(sessionTitle({ summary: "/clear" }, false)).toBeUndefined();
  });
});
