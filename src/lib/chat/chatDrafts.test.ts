import { describe, expect, it } from "vitest";
import {
  appendDictation,
  dropDraft,
  EMPTY_DRAFT,
  getDraft,
  moveDraft,
  setDraft,
} from "@/lib/chat/chatDrafts";

describe("chatDrafts", () => {
  it("adds a dictation after what is typed, the pane mounted or not", () => {
    setDraft("p1", { text: "corrige ", images: [] });
    appendDictation("p1", "le test");
    expect(getDraft("p1").text).toBe("corrige le test");
    appendDictation("p2", "bonjour");
    expect(getDraft("p2").text).toBe("bonjour");
  });

  it("follows a pane relaunched under a new id, and empties to nothing", () => {
    setDraft("old", { text: "brouillon", images: [] });
    moveDraft("old", "new");
    expect(getDraft("old")).toBe(EMPTY_DRAFT);
    expect(getDraft("new").text).toBe("brouillon");
    setDraft("new", { text: "", images: [] });
    expect(getDraft("new")).toBe(EMPTY_DRAFT);
  });

  it("lands a dictation finishing under the old id in the new pane", () => {
    moveDraft("a1", "a2");
    appendDictation("a1", "fin de dictée");
    expect(getDraft("a2").text).toBe("fin de dictée");
    dropDraft("a2");
    expect(getDraft("a2")).toBe(EMPTY_DRAFT);
    appendDictation("a1", "après fermeture");
    expect(getDraft("a2")).toBe(EMPTY_DRAFT);
  });
});
