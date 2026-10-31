import { describe, expect, it } from "vitest";
import {
  DRAFT_TTL_MS,
  KEPT_IMAGES,
  parseDrafts,
  serializeDrafts,
} from "@/lib/chat/chatDraftStore";
import type { ChatDraft } from "@/lib/chat/chatDrafts";

const NOW = 1_800_000_000_000;
const image = (n: number, size = 10) => ({
  id: `i${n}`,
  url: "",
  mediaType: "image/png",
  data: String(n).repeat(size),
});

describe("chat drafts kept across a reload", () => {
  it("keeps the text and the newest images, within the caps", () => {
    const drafts = new Map<string, ChatDraft>([
      [
        "p1",
        {
          text: "corrige le test",
          images: [1, 2, 3, 4, 5].map((n) => image(n)),
        },
      ],
      ["p2", { text: "", images: [] }],
    ]);
    const back = parseDrafts(
      serializeDrafts(drafts, new Map([["p1", NOW]]), NOW),
      NOW,
    );
    expect([...back.keys()]).toEqual(["p1"]);
    const p1 = back.get("p1")!.draft;
    expect(p1.text).toBe("corrige le test");
    expect(p1.images.map((i) => i.data[0])).toEqual(["2", "3", "4", "5"]);
    expect(p1.images).toHaveLength(KEPT_IMAGES);
    expect(p1.images[0].url).toBe(`data:image/png;base64,${"2".repeat(10)}`);
    const textOnly = parseDrafts(
      serializeDrafts(drafts, new Map(), NOW, false),
      NOW,
    );
    expect(textOnly.get("p1")!.draft.images).toEqual([]);
  });

  it("keeps the attached paths, images or not", () => {
    const drafts = new Map<string, ChatDraft>([
      [
        "p1",
        {
          text: "",
          images: [],
          files: [{ id: "f1", path: "C:\\Users\\me\\Capture d'écran 1.png" }],
        },
      ],
    ]);
    const raw = serializeDrafts(drafts, new Map(), NOW, false);
    const files = parseDrafts(raw, NOW).get("p1")!.draft.files;
    expect(files?.map((f) => f.path)).toEqual([
      "C:\\Users\\me\\Capture d'écran 1.png",
    ]);
  });

  it("drops stale drafts and torn values", () => {
    const raw = serializeDrafts(
      new Map([["old", { text: "vieux", images: [] }]]),
      new Map([["old", NOW - DRAFT_TTL_MS - 1]]),
      NOW,
    );
    expect(parseDrafts(raw, NOW).size).toBe(0);
    expect(parseDrafts("{torn", NOW).size).toBe(0);
  });
});
