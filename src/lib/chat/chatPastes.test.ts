import { describe, expect, it } from "vitest";
import {
  brokenPastes,
  dropTag,
  editPaste,
  expandPastes,
  pasteInto,
  pastesIn,
  rememberPastes,
  tagAt,
  unfoldPaste,
} from "@/lib/chat/chatPastes";

const LONG =
  "TypeError: Cannot read properties of undefined reading tabs at restoreSession in session.ts";

describe("a long text pasted in the chat's input", () => {
  it("stands as a tag at the caret, and sends the text itself", () => {
    const r = pasteInto("Corrige  puis relance", 8, 8, LONG, []);
    expect(r?.text).toBe("Corrige [Texte collé #1 · 12 mots] puis relance");
    expect(r?.caret).toBe(8 + "[Texte collé #1 · 12 mots]".length);
    expect(expandPastes(r!.text, r!.pastes)).toBe(
      `Corrige ${LONG} puis relance`,
    );
    // Short: pasted as is.
    expect(pasteInto("", 0, 0, "trois petits mots", [])).toBeNull();
  });

  it("puts the text back in the tag's place when pasted again", () => {
    const first = pasteInto("Vois ", 5, 5, LONG, [])!;
    const again = pasteInto(first.text, 0, 0, LONG, first.pastes)!;
    expect(again.text).toBe(`Vois ${LONG}`);
    expect(again.pastes).toEqual([]);
  });

  it("edits a paste from its tag, the tag's count following", () => {
    const r = pasteInto("", 0, 0, LONG, [])!;
    const edited = editPaste(r.text, r.pastes, 1, "un deux");
    expect(edited.text).toBe("[Texte collé #1 · 2 mots]");
    expect(expandPastes(edited.text, edited.pastes)).toBe("un deux");
    expect(unfoldPaste(edited.text, edited.pastes, 1).text).toBe("un deux");
  });

  it("leaves a tag the user typed over as plain text, and says it", () => {
    const r = pasteInto("", 0, 0, LONG, [])!;
    const broken = r.text.replace("12 mots", "12 mot");
    expect(expandPastes(broken, r.pastes)).toBe(broken);
    expect(brokenPastes(broken, r.pastes)).toEqual(r.pastes);
    expect(brokenPastes(r.text, r.pastes)).toEqual([]);
  });

  it("takes a tag as one block: by its edges, never inside", () => {
    const r = pasteInto("a  b", 2, 2, LONG, [])!;
    const tag = "[Texte collé #1 · 12 mots]";
    expect(tagAt(r.text, r.pastes, 2 + tag.length, "after")?.start).toBe(2);
    expect(tagAt(r.text, r.pastes, 2, "before")?.end).toBe(2 + tag.length);
    expect(tagAt(r.text, r.pastes, 5, "inside")?.start).toBe(2);
    expect(tagAt(r.text, r.pastes, 1, "inside")).toBeNull();
    const span = tagAt(r.text, r.pastes, 2, "before")!;
    expect(dropTag(r.text, r.pastes, span)).toEqual({
      text: "a  b",
      pastes: [],
    });
  });

  it("finds a sent paste in the user's frame again", () => {
    rememberPastes([LONG]);
    expect(pastesIn(`Corrige ${LONG} vite`)).toEqual([LONG]);
    expect(pastesIn("autre chose")).toEqual([]);
  });
});
