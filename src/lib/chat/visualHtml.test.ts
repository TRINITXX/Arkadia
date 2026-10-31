import { describe, expect, it } from "vitest";
import {
  imageMime,
  imageVerdict,
  localImageRefs,
  pageSizeError,
  readVisualReport,
  staleVisualFiles,
  VISUAL_IMAGE_MAX,
  VISUAL_PAGE_MAX,
  visualResult,
  withImages,
  type VisualReport,
} from "@chat-server/visualHtml";

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => new TextEncoder().encode(s);

const clean: VisualReport = {
  errors: [],
  consoleErrors: [],
  blocked: [],
  height: 320,
  width: 728,
  scrollWidth: 728,
  empty: false,
  followsFrame: false,
};

describe("localImageRefs", () => {
  it("finds drive paths in src, srcset, CSS url() and file: URLs, nothing else", () => {
    const html = [
      '<img src="C:\\shots\\a.png">',
      "<img srcset='C:/shots/b.png 1x, https://x.test/c.png 2x'>",
      "<style>.h{background:url('file:///D:/My%20Pics/d.webp')}</style>",
      '<img src="\\\\server\\share\\e.png"><img src="img/f.png"><img src="https://x.test/g.png">',
    ].join("");
    expect(localImageRefs(html).map((r) => r.path)).toEqual([
      "C:\\shots\\a.png",
      "C:/shots/b.png",
      "D:/My Pics/d.webp",
    ]);
  });

  it("keeps an apostrophe, brackets and entities in a name (« Capture d'écran », « photo (1) »)", () => {
    const html = [
      `<img src="C:\\Captures\\Capture d'écran 2026-10-31.png">`,
      "<img src='C:/x/l&#39;été.jpg'>",
      '<div style="background:url(&quot;C:/bg.jpg&quot;)"></div>',
      "<style>.h{background:url(C:/photos/photo (1).png) no-repeat}</style>",
    ].join("");
    expect(localImageRefs(html).map((r) => r.path)).toEqual([
      "C:\\Captures\\Capture d'écran 2026-10-31.png",
      "C:/x/l'été.jpg",
      "C:/bg.jpg",
      "C:/photos/photo (1).png",
    ]);
  });

  it("only counts image places: a link, a video or a script to a local file is left alone", () => {
    const html = [
      '<a href="C:\\docs\\plan.pdf">plan</a>',
      '<video src="C:/v.mp4" poster="C:/v.jpg"><source src="C:/v.webm"></video>',
      '<script src="C:/x.js"></script><link rel="stylesheet" href="C:/x.css">',
      '<link rel="icon" href="C:/favicon.png"><svg><image href="C:/s.png"/></svg>',
    ].join("");
    expect(localImageRefs(html).map((r) => r.path)).toEqual([
      "C:/v.jpg",
      "C:/favicon.png",
      "C:/s.png",
    ]);
  });

  it("swaps an image place for its data URL, never the path quoted in the text", () => {
    const html = '<p>C:\\a.png</p><img src="C:\\a.png">';
    const out = withImages(
      html,
      new Map([["C:\\a.png", "data:image/png;base64,AA"]]),
    );
    expect(out).toBe('<p>C:\\a.png</p><img src="data:image/png;base64,AA">');
  });
});

describe("image places", () => {
  it("counts CSS only in a sheet or a style attribute, never text, scripts or comments", () => {
    const html = [
      "<pre>background: url('C:/z.png')</pre>",
      `<script>const s = '<img src="C:/s.png">'; const c = "url(C:/c.png)";</script>`,
      "<!-- <img src='C:/comment.png'> -->",
      "<style>.a{background:url('C:/sheet.png')}</style>",
      '<div style="background:url(C:/attr.png)"></div>',
    ].join("");
    expect(localImageRefs(html).map((r) => r.path)).toEqual(["C:/sheet.png", "C:/attr.png"]);
  });

  it("counts each mention: every one carries the whole image", () => {
    const html = Array(31).fill('<img src="C:/big.png">').join("");
    expect(localImageRefs(html)).toEqual([{ raw: "C:/big.png", path: "C:/big.png", mentions: 31 }]);
    // One 8 Mo image named 31 times is 248 Mo: refused, saying why.
    expect(imageVerdict(8_000_000, 0, null, 31)).toMatchObject({
      reason: expect.stringContaining("named 31 times"),
    });
  });

  it("refuses a page too heavy to travel, with a clear reason", () => {
    expect(pageSizeError("x".repeat(1000))).toBeNull();
    expect(pageSizeError("x".repeat(VISUAL_PAGE_MAX + 1))).toContain("Not shown");
  });

  it("prunes kept copies past 30 days, then the oldest past 400 Mo", () => {
    const day = 86_400_000;
    const now = 100 * day;
    const files = [
      { name: "old.html", mtimeMs: now - 31 * day, size: 10 },
      { name: "new.html", mtimeMs: now - day, size: 300 * 1024 * 1024 },
      { name: "older.html", mtimeMs: now - 2 * day, size: 200 * 1024 * 1024 },
    ];
    expect(staleVisualFiles(files, now).sort()).toEqual(["old.html", "older.html"]);
  });
});

describe("imageMime", () => {
  it("knows an image by its bytes, not its name", () => {
    expect(
      imageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("image/png");
    expect(imageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(imageMime(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(
      imageMime(
        text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">'),
      ),
    ).toBe("image/svg+xml");
    // A program or a text file renamed .png.
    expect(imageMime(text("MZ\x90\0\x03"))).toBeNull();
    expect(imageMime(text("hello"))).toBeNull();
  });

  it("refuses a file too large or past the page's total before reading it", () => {
    expect(imageVerdict(VISUAL_IMAGE_MAX + 1, 0, null)).toHaveProperty(
      "reason",
    );
    expect(imageVerdict(5_000_000, 20_000_000, null)).toHaveProperty("reason");
    expect(imageVerdict(10, 0, text("hello"))).toEqual({
      reason: "not an image (its bytes say so)",
    });
  });
});

describe("visualResult", () => {
  it("says shown when checked clean, and unverified when no report came", () => {
    expect(visualResult(clean, [])).toMatchObject({ isError: false });
    expect(visualResult(clean, []).text).toContain(
      "Shown in the chat (checked",
    );
    expect(visualResult(null, []).text).toContain("not verified");
  });

  it("makes every problem an error Claude can fix, images left out included", () => {
    const r = visualResult(
      {
        ...clean,
        errors: ["ReferenceError: x is not defined (line 3)"],
        blocked: [
          "https://evil.test/a.js (refused by the CSP: script-src-elem)",
        ],
        followsFrame: true,
        scrollWidth: 1200,
      },
      [{ path: "C:\\x.png", reason: "not found" }],
    );
    expect(r.isError).toBe(true);
    expect(r.text).toContain("- Script error: ReferenceError");
    expect(r.text).toContain("- Not loaded: https://evil.test/a.js");
    expect(r.text).toContain("vh units");
    expect(r.text).toContain("1200px wide in a 728px frame");
    expect(r.text).toContain("Note: local image not inlined: C:\\x.png");
  });

  it("only notes a local file left out: an image it breaks shows in the report", () => {
    const r = visualResult(clean, [{ path: "C:\\x.png", reason: "not found" }]);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Note: local image not inlined");
  });

  it("reads only a well-formed report from the page", () => {
    expect(readVisualReport("x")).toBeNull();
    expect(readVisualReport({ errors: "x" })).toBeNull();
    const read = readVisualReport({
      ...clean,
      errors: Array(50).fill("e"),
      height: 12.6,
    });
    expect(read?.errors).toHaveLength(20);
    expect(read?.height).toBe(13);
  });
});
