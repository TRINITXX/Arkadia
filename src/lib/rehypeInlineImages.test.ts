import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, expect, it } from "vitest";
import {
  IMAGE_PATH_PROP,
  rehypeInlineImages,
  type HastNode,
} from "./rehypeInlineImages";

/**
 * Renders `text` through the very pipeline the modern view uses, turning each
 * marked path into an `<img>` so the assertions can read it back.
 */
function render(text: string, baseDir?: string) {
  return renderToStaticMarkup(
    createElement(Markdown, {
      rehypePlugins: [
        [rehypeInlineImages, { source: text, baseDir }],
      ] as never[],
      components: {
        span: ({ node, children }) => {
          const path = (node as HastNode | undefined)?.properties?.[
            IMAGE_PATH_PROP
          ];
          return typeof path === "string"
            ? createElement("img", { src: path })
            : createElement("span", null, children);
        },
      },
      children: text,
    }),
  );
}

describe("rehypeInlineImages", () => {
  it("keeps the backslash markdown would eat before a dot", () => {
    // `\.` is a markdown escape: by the time a component sees the text, the
    // path has lost the separator before `.screenshots` and points nowhere.
    const html = render("- C:\\proj\\.screenshots\\shot.png\n");
    expect(html).toContain('src="C:\\proj\\.screenshots\\shot.png"');
  });

  it("marks a path in a paragraph and leaves the prose in place", () => {
    const html = render("voir C:\\a\\x.png pour la suite");
    expect(html).toContain('src="C:\\a\\x.png"');
    expect(html).toContain("voir ");
    expect(html).toContain(" pour la suite");
  });

  it("resolves a relative mention against the base dir", () => {
    const html = render("voir .screenshots/x.png", "C:\\proj");
    expect(html).toContain('src="C:\\proj\\.screenshots\\x.png"');
  });

  it("lays a list of captures out as one wrapping strip", () => {
    const html = render(
      "Captures :\n- `C:\\a\\one.png` (avant)\n- `C:\\a\\two.png`\n",
    );
    expect(html).toContain('class="modern-gallery"');
    expect(html.match(/modern-gallery-cell/g)).toHaveLength(2);
    // The prose that qualifies a capture rides along as its caption.
    expect(html).toContain("(avant)");
    expect(html).not.toContain("<li>");
  });

  it("leaves a list alone when an item carries no image", () => {
    const html = render("- `C:\\a\\one.png`\n- juste du texte\n");
    expect(html).not.toContain("modern-gallery");
    expect(html).toContain("<li>");
  });

  it("groups stacked image-only paragraphs", () => {
    const html = render("C:\\a\\one.png\n\nC:\\a\\two.png\n");
    expect(html).toContain('class="modern-gallery"');
    expect(html.match(/modern-gallery-cell/g)).toHaveLength(2);
  });

  it("leaves a lone illustration where the sentence is", () => {
    const html = render("voici C:\\a\\one.png la preuve");
    expect(html).not.toContain("modern-gallery");
  });

  it("leaves a fenced code block verbatim", () => {
    const html = render("```\ncp C:\\a\\x.png .\n```\n");
    expect(html).not.toContain("<img");
    expect(html).toContain("C:\\a\\x.png");
  });
});
