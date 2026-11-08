import { describe, expect, it } from "vitest";
import {
  brokenPastes,
  dropTag,
  editPaste,
  expandPastes,
  framePastes,
  pasteInto,
  pasteOfHref,
  pastesIn,
  rememberPastes,
  tagAt,
  unfoldPaste,
  unwrapPastes,
  withPasteTags,
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

  it("tags the pastes a message carries, where this page never sent them", () => {
    // The phone remembers nothing: the message's own pastes are enough.
    const carried = "un deux trois quatre cinq six sept huit neuf dix onze";
    const text = `Vois ${carried} puis ${LONG}`;
    rememberPastes([LONG]);
    const pastes = framePastes(text, [carried, "absent du message"]);
    expect(pastes).toEqual([LONG, carried]);
    const shown = withPasteTags(text, pastes);
    expect(shown).toBe(
      "Vois [Texte collé · 11 mots](#arkadia-paste-1) puis " +
        "[Texte collé · 12 mots](#arkadia-paste-0)",
    );
    expect(pasteOfHref("#arkadia-paste-1", pastes)).toBe(carried);
    expect(pasteOfHref("https://claude.ai/artifact/x", pastes)).toBeNull();
  });
});

describe("a user message read back from the session", () => {
  it("shows Claude Code's tagged pastes as text, the long ones as tags", () => {
    const short = "trois petits mots";
    const r = unwrapPastes(
      `Résume ce texte en une ligne :\n\n<pasted_content id="d947">\n${LONG}\n</pasted_content id="d947">\n` +
        `\n<pasted_content id="0a1b">\n${short}\n</pasted_content id="0a1b">\n\npuis relance`,
    );
    expect(r.text).toBe(
      `Résume ce texte en une ligne :\n\n${LONG}\n\n${short}\n\npuis relance`,
    );
    expect(r.pastes).toEqual([LONG]);
    // No tag: the text as is.
    expect(unwrapPastes("Corrige ça")).toEqual({
      text: "Corrige ça",
      pastes: [],
    });
  });

  it("puts back a tag's name Claude Code escaped inside a paste", () => {
    const body = `${LONG} <\\pasted_content id="ffff"> fin`;
    const r = unwrapPastes(
      `<pasted_content id="c3d4">\n${body}\n</pasted_content id="c3d4">\n`,
    );
    expect(r.text).toBe(`${LONG} <pasted_content id="ffff"> fin`);
    expect(r.pastes).toEqual([r.text]);
  });
});
