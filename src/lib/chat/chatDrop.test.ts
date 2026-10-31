import { describe, expect, it } from "vitest";
import { dropPathsInChat } from "@/lib/chat/chatDrop";
import { dropDraft, getDraft, setDraft } from "@/lib/chat/chatDrafts";

describe("dropPathsInChat", () => {
  it("attaches the dropped files as cards, the text untouched, input on screen or not", () => {
    setDraft("drop-pane", { text: "regarde", images: [] });
    dropPathsInChat("drop-pane", ["C:\\a b\\x.png", "C:\\y.txt"], null, false);
    const draft = getDraft("drop-pane");
    expect(draft.text).toBe("regarde");
    expect(draft.files?.map((f) => f.path)).toEqual([
      "C:\\a b\\x.png",
      "C:\\y.txt",
    ]);
    dropDraft("drop-pane");
  });
});
