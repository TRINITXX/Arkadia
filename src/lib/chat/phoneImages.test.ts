import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/chatState";
import type { ToolItem } from "@/lib/chat/chatGroups";
import {
  itemImagePaths,
  readImages,
  viewerImages,
  viewerIndex,
} from "@/lib/chat/phoneImages";

const read = (id: string, path: string): ToolItem => ({
  kind: "tool",
  id,
  name: "Read",
  input: { file_path: path },
});

describe("itemImagePaths", () => {
  it("gives the images a reply names, never its videos", () => {
    const item: ChatItem = {
      kind: "text",
      id: "a",
      text: "Capture : C:\\p\\.screenshots\\vue_v1.png et C:\\p\\film.mp4",
      streaming: false,
    };
    expect(itemImagePaths(item)).toEqual(["C:\\p\\.screenshots\\vue_v1.png"]);
    // Read again for the same item: the same list.
    expect(itemImagePaths(item)).toBe(itemImagePaths(item));
  });

  it("gives the user's named images but not their pasted ones", () => {
    const item: ChatItem = {
      kind: "user",
      id: "u",
      text: "regarde C:\\p\\a.png",
      images: 1,
      pasted: ["data:image/png;base64,AA"],
    };
    expect(itemImagePaths(item)).toEqual(["C:\\p\\a.png"]);
  });
});

describe("readImages", () => {
  it("keeps the latest four images read, each once, in order", () => {
    const tools = [
      read("1", "C:\\a.png"),
      read("2", "C:\\b.png"),
      read("3", "C:\\notes.md"),
      read("4", "C:\\c.png"),
      read("5", "C:\\d.png"),
      read("6", "c:/A.png"),
    ];
    expect(readImages(tools)).toEqual([
      "C:\\b.png",
      "C:\\c.png",
      "C:\\d.png",
      "c:/A.png",
    ]);
  });
});

describe("viewer", () => {
  it("walks the chat's images once each, a pasted one found by its data", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u", text: "x", images: 1, pasted: ["data:1"] },
      read("r", "C:\\shot.png"),
      { kind: "text", id: "a", text: "C:/shot.png", streaming: false },
    ];
    const list = viewerImages(items);
    expect(list.map((r) => r.url ?? r.path)).toEqual([
      "data:1",
      "C:\\shot.png",
    ]);
    expect(viewerIndex(list, { path: "x", url: "data:1" })).toBe(0);
    expect(viewerIndex(list, { path: "c:/SHOT.png" })).toBe(1);
    expect(viewerIndex(list, { path: "C:\\other.png" })).toBe(-1);
  });
});
