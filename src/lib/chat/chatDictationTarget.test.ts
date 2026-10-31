import { describe, expect, it } from "vitest";
import {
  appendDictation,
  getDraft,
  redirectDictation,
  setDraft,
} from "@/lib/chat/chatDrafts";

describe("a dictation started from the question sheet", () => {
  it("lands in its field once, then the input's next one in the draft", () => {
    const field: string[] = [];
    redirectDictation("sheet-pane", (text) => field.push(text));
    appendDictation("sheet-pane", "plus sûr");
    appendDictation("sheet-pane", "corrige le test");
    expect(field).toEqual(["plus sûr"]);
    expect(getDraft("sheet-pane").text).toBe("corrige le test");
  });

  it("leaves no target once cleared (a dictation that failed or never started)", () => {
    const field: string[] = [];
    setDraft("sheet-pane-2", { text: "", images: [] });
    redirectDictation("sheet-pane-2", (text) => field.push(text));
    redirectDictation("sheet-pane-2", null);
    appendDictation("sheet-pane-2", "bonjour");
    expect(field).toEqual([]);
    expect(getDraft("sheet-pane-2").text).toBe("bonjour");
  });
});
