import { describe, expect, it } from "vitest";
import {
  attachPaths,
  fileName,
  mergeDrafts,
  messageCards,
  messageDraft,
  pastedPaths,
  splitAttachedLines,
  withAttachedPaths,
} from "@/lib/chat/chatAttachments";
import { EMPTY_DRAFT } from "@/lib/chat/chatDrafts";
import { brokenPastes, expandPastes } from "@/lib/chat/chatPastes";

const SHOT =
  "C:\\Users\\TRINITX\\Pictures\\Screenshots\\Capture d'écran 2026-10-31 130956.png";
const NOTE = "D:/Docs/Été 2026/note de frais.pdf";

const paths = (d: { files?: { path: string }[] }) =>
  (d.files ?? []).map((f) => f.path);

describe("attached paths in the message sent", () => {
  it("go quoted on the text's last line", () => {
    expect(withAttachedPaths("regarde", [SHOT, NOTE])).toBe(
      `regarde\n\n"${SHOT}" "${NOTE}"`,
    );
    expect(withAttachedPaths("", [SHOT])).toBe(`"${SHOT}"`);
    expect(withAttachedPaths("seul", [])).toBe("seul");
  });

  it("come back apart from the text", () => {
    const sent = withAttachedPaths("regarde ça\net ça", [SHOT, NOTE]);
    expect(splitAttachedLines(sent)).toEqual({
      text: "regarde ça\net ça",
      paths: [SHOT, NOTE],
    });
  });
});

describe("the user's frame", () => {
  it("shows every quoted path as a card, its name left in a sentence", () => {
    expect(messageCards(`"${SHOT}" bug du menu`)).toEqual({
      text: "`Capture d'écran 2026-10-31 130956.png` bug du menu",
      paths: [SHOT],
    });
  });

  it("takes a bare path alone on its line, never one inside prose", () => {
    expect(messageCards(`${SHOT}\nle menu déborde`)).toEqual({
      text: "le menu déborde",
      paths: [SHOT],
    });
    expect(messageCards(`voir ${SHOT} stp`).paths).toEqual([]);
  });

  it("never takes a path with a line number or a relative one", () => {
    expect(messageCards('"C:\\a\\b.ts:12" et "src\\x.ts"').paths).toEqual([]);
  });

  it("leaves a path followed by words on its line as text", () => {
    const line = `${SHOT} le menu déborde`;
    expect(messageCards(line)).toEqual({ text: line, paths: [] });
    expect(splitAttachedLines("C:\\ est plein").paths).toEqual([]);
  });

  it("never touches a path in code", () => {
    const fenced = '```json\n{ "cwd": "C:\\\\proj" }\n"C:\\app\\x.exe"\n```';
    expect(messageCards(fenced)).toEqual({ text: fenced, paths: [] });
    expect(splitAttachedLines(fenced).text).toBe(fenced);
    expect(messageCards(`lance \`"${NOTE}"\``).paths).toEqual([]);
  });
});

describe("a pasted text of paths", () => {
  it("reads Explorer's quoted paths and bare ones, one per line", () => {
    expect(pastedPaths(`"${SHOT}"\r\n"${NOTE}"`)).toEqual([SHOT, NOTE]);
    expect(pastedPaths(`"${SHOT}" "${NOTE}"`)).toEqual([SHOT, NOTE]);
    expect(pastedPaths(`  ${SHOT}  \n${NOTE}\n`)).toEqual([SHOT, NOTE]);
  });

  it("is plain text as soon as anything else is in it", () => {
    expect(pastedPaths(`regarde ${SHOT}`)).toBeNull();
    expect(pastedPaths(`"${SHOT}" stp`)).toBeNull();
    expect(pastedPaths("\\\\serveur\\partage\\x.png")).toBeNull();
    expect(pastedPaths("")).toBeNull();
  });
});

describe("the input's cards", () => {
  it("never attach a path twice, whatever its case or slashes", () => {
    const once = attachPaths(EMPTY_DRAFT, [SHOT, NOTE]);
    const twice = attachPaths(once, [
      SHOT.toUpperCase(),
      NOTE.replace(/\//g, "\\"),
    ]);
    expect(twice).toBe(once);
    expect(paths(once)).toEqual([SHOT, NOTE]);
  });

  it("name a file or a folder by its last part", () => {
    expect(fileName(SHOT)).toBe("Capture d'écran 2026-10-31 130956.png");
    expect(fileName("C:\\Users\\me\\projet\\")).toBe("projet");
  });
});

describe("a withdrawn message back in the input", () => {
  it("gets its text, its attachments and its kept pasted images back", () => {
    const back = messageDraft(withAttachedPaths("corrige", [SHOT]), [
      "data:image/png;base64,AAA",
    ]);
    expect(back.text).toBe("corrige");
    expect(paths(back)).toEqual([SHOT]);
    expect(back.images).toMatchObject([
      { mediaType: "image/png", data: "AAA", url: "data:image/png;base64,AAA" },
    ]);
  });

  it("goes before what the input holds, the cards merged", () => {
    const now = attachPaths({ text: "nouveau", images: [] }, [NOTE, SHOT]);
    const merged = mergeDrafts(messageDraft(`ancien\n\n"${SHOT}"`), now);
    expect(merged.text).toBe("ancien\nnouveau");
    expect(paths(merged)).toEqual([SHOT, NOTE]);
    expect(mergeDrafts(messageDraft("seul"), EMPTY_DRAFT).text).toBe("seul");
    // The input's pasted texts stay: their tags still stand for them.
    const tagged = {
      text: "[Texte collé #1 · 2 mots]",
      images: [],
      pastes: [{ id: 1, text: "deux mots" }],
    };
    expect(mergeDrafts(messageDraft("ancien"), tagged).pastes).toEqual(
      tagged.pastes,
    );
  });

  it("gets its pasted texts back as tags, numbered after the input's", () => {
    const log =
      "TypeError: Cannot read properties of undefined reading tabs at restoreSession";
    const back = messageDraft(`Corrige :\n\n${log}`, [], [log]);
    expect(back.text).toBe("Corrige :\n\n[Texte collé #1 · 10 mots]");
    // The input already holds its own #1: it keeps it, the one coming back
    // takes #2.
    const now = {
      text: "et [Texte collé #1 · 11 mots]",
      images: [],
      pastes: [
        {
          id: 1,
          text: "un deux trois quatre cinq six sept huit neuf dix onze",
        },
      ],
    };
    const merged = mergeDrafts(back, now);
    expect(merged.text).toBe(
      "Corrige :\n\n[Texte collé #2 · 10 mots]\net [Texte collé #1 · 11 mots]",
    );
    expect(expandPastes(merged.text, merged.pastes)).toBe(
      `Corrige :\n\n${log}\net ${now.pastes[0].text}`,
    );
    // A tag the user broke in the input is still said at sending.
    const broken = mergeDrafts(back, {
      ...now,
      text: "et [Texte collé #1 · 11 mo",
    });
    expect(brokenPastes(broken.text, broken.pastes)).toEqual(now.pastes);
  });
});

describe("pasted images put back in the input", () => {
  const PNG = "data:image/png;base64,AAA";
  it("keep the numbers their text gives them", () => {
    const back = messageDraft("vois [Image #2] et [Image #3]", [PNG, PNG]);
    expect(back.images.map((i) => i.n)).toEqual([2, 3]);
  });

  it("number the input's own after them, their tags following", () => {
    const back = messageDraft("vois [Image #1]", [PNG]);
    const now = {
      text: "et [Image #1]",
      images: [
        { id: "x", url: PNG, mediaType: "image/png", data: "AAA", n: 1 },
      ],
    };
    const merged = mergeDrafts(back, now);
    expect(merged.text).toBe("vois [Image #1]\net [Image #2]");
    expect(merged.images.map((i) => i.n)).toEqual([1, 2]);
  });
});
