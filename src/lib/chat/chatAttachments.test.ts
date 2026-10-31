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
  });
});
