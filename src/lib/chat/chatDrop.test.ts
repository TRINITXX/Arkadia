import { describe, expect, it } from "vitest";
import { dropPathsInChat } from "@/lib/chat/chatDrop";
import { dropDraft, getDraft, setDraft } from "@/lib/chat/chatDrafts";

describe("dropPathsInChat", () => {
  it("adds the dropped files' quoted paths to the pane's draft, input on screen or not", () => {
    setDraft("drop-pane", { text: "regarde", images: [] });
    dropPathsInChat("drop-pane", ["C:\\a b\\x.png", "C:\\y.txt"], null, false);
    expect(getDraft("drop-pane").text).toBe(
      'regarde "C:\\a b\\x.png" "C:\\y.txt" ',
    );
    dropDraft("drop-pane");
  });
});
