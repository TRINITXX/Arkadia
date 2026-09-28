import { describe, expect, it } from "vitest";
import {
  galleryImages,
  messageImages,
  messageStripImages,
  toolImages,
} from "./imageGallery";

describe("messageStripImages", () => {
  it("leaves out paths rendered inline, keeps those inside a fence", () => {
    const text = "voir C:\\a\\x.png\n\n```\ncp C:\\a\\y.png .\n```\n";
    expect(messageStripImages({ kind: "assistant", text })).toEqual([
      { path: "C:\\a\\y.png" },
    ]);
  });

  it("still shows pasted images", () => {
    expect(
      messageStripImages({
        kind: "user",
        text: "C:\\a\\x.png",
        images: [{ path: "C:\\cache\\1.png", media_type: "image/png" }],
      }),
    ).toEqual([{ path: "C:\\cache\\1.png", mediaType: "image/png" }]);
  });
});

describe("messageImages", () => {
  it("prefers pasted images over paths in the text", () => {
    expect(
      messageImages({
        kind: "user",
        text: "voir C:\\a\\x.png",
        images: [{ path: "C:\\cache\\1.png", media_type: "image/png" }],
      }),
    ).toEqual([{ path: "C:\\cache\\1.png", mediaType: "image/png" }]);
  });

  it("falls back to paths mentioned in the text", () => {
    expect(
      messageImages({ kind: "assistant", text: "capture C:\\a\\x.png" }),
    ).toEqual([{ path: "C:\\a\\x.png" }]);
  });
});

describe("toolImages", () => {
  it("reads the output only when results are shown", () => {
    const block = {
      kind: "tool" as const,
      tool_input: JSON.stringify({ file_path: "C:\\a\\in.png" }),
      tool_output: "saved C:\\a\\out.png",
    };
    expect(toolImages(block, false)).toEqual([{ path: "C:\\a\\in.png" }]);
    expect(toolImages(block, true)).toEqual([
      { path: "C:\\a\\in.png" },
      { path: "C:\\a\\out.png" },
    ]);
  });
});

describe("galleryImages", () => {
  it("walks blocks in order and keeps each path once", () => {
    expect(
      galleryImages(
        [
          { kind: "user", text: "C:\\a\\1.png" },
          { kind: "assistant", text: "C:\\a\\2.png puis c:\\A\\1.PNG" },
          { kind: "user", text: "C:\\a\\3.png" },
        ],
        false,
      ).map((r) => r.path),
    ).toEqual(["C:\\a\\1.png", "C:\\a\\2.png", "C:\\a\\3.png"]);
  });
});
