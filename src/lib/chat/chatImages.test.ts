import { describe, expect, it } from "vitest";
import { chatGallery, userMessageView } from "@/lib/chat/chatImages";
import type { ChatItem } from "@/lib/chat/chatState";

const CWD = "C:\\proj";

describe("chatGallery", () => {
  const items: ChatItem[] = [
    {
      kind: "user",
      id: "u1",
      text: "Regarde .screenshots/avant.png",
      images: 2,
      // The first image of the two went out of memory.
      pasted: ["data:image/png;base64,BBB"],
    },
    {
      kind: "text",
      id: "t1",
      text: "Voici `C:\\proj\\.screenshots\\apres.png` et C:\\proj\\.screenshots\\avant.png",
      streaming: false,
    },
    { kind: "thinking", id: "th", text: "C:\\proj\\x.png", streaming: false },
    {
      kind: "user",
      id: "u2",
      text: "",
      images: 1,
      pasted: ["data:image/png;base64,CCC"],
    },
  ];
  const gallery = chatGallery(items, CWD);

  it("gives each message its pasted images, then the files its text names", () => {
    expect(gallery.byItem.get("u1")).toEqual([
      { path: "Image collée 2", url: "data:image/png;base64,BBB" },
      { path: "C:\\proj\\.screenshots\\avant.png" },
    ]);
    expect(gallery.byItem.get("t1")?.map((r) => r.path)).toEqual([
      "C:\\proj\\.screenshots\\apres.png",
      "C:\\proj\\.screenshots\\avant.png",
    ]);
    expect(gallery.byItem.has("th")).toBe(false);
  });

  it("reads a path under a folder with a space as one file", () => {
    const root = "C:\\Users\\me\\Claude Desktop\\proj";
    const { byItem } = chatGallery(
      [
        {
          kind: "text",
          id: "t",
          text: `Capture : ${root}\\.screenshots\\vue.png`,
          streaming: false,
        },
      ],
      root,
    );
    expect(byItem.get("t")).toEqual([
      { path: `${root}\\.screenshots\\vue.png` },
    ]);
  });

  it("walks every image once, in reading order, for the lightbox", () => {
    expect(gallery.all.map((r) => r.path)).toEqual([
      "Image collée 2",
      "C:\\proj\\.screenshots\\avant.png",
      "C:\\proj\\.screenshots\\apres.png",
      "Image collée 3",
    ]);
  });
});

describe("the user's attached files", () => {
  const SHOT =
    "C:\\Users\\TRINITX\\Pictures\\Screenshots\\Capture d'écran 2026-10-31 130956.png";
  const PDF = "C:\\proj\\devis.pdf";
  const sent: ChatItem = {
    kind: "user",
    id: "u",
    text: `"${SHOT}" le menu déborde\n\n"${PDF}"`,
    images: 0,
  };

  it("leave the text for cards, the image ones in the lightbox's walk", () => {
    expect(userMessageView(sent, CWD)).toEqual({
      text: "`Capture d'écran 2026-10-31 130956.png` le menu déborde",
      paths: [SHOT, PDF],
      named: [],
    });
    expect(chatGallery([sent], CWD).all).toEqual([{ path: SHOT }]);
  });

  it("put an image Claude reads in the walk, never another file", () => {
    const read = (id: string, file_path: string): ChatItem => ({
      kind: "tool",
      id,
      name: "Read",
      input: { file_path },
    });
    const { all, byItem } = chatGallery(
      [read("r1", SHOT), read("r2", PDF)],
      CWD,
    );
    expect(all).toEqual([{ path: SHOT }]);
    expect(byItem.has("r2")).toBe(false);
  });
});
