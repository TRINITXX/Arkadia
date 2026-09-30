// Rendering-time bridge between the modern view's image handling and the
// markdown pipeline: it marks the image paths a message mentions so they can
// be rendered as the images themselves.

import { splitImagePaths } from "@/lib/imagePaths";

/** The bits of a hast node this file needs; the tree is walked by hand. */
export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

/** Marks a text node's image path mentions, read off the original markdown. */
export const IMAGE_PATH_PROP = "dataArkadiaImagePath";
export const IMAGE_LABEL_PROP = "dataArkadiaImageLabel";

/**
 * Turns every image path mentioned in prose into a marker element, which the
 * `span` override then renders as the image itself.
 *
 * It matches on the ORIGINAL markdown (through each text node's source
 * offsets), never on the rendered text: markdown unescapes `\.` to `.`, which
 * silently turns `…\.screenshots\x.png` into a path that exists nowhere. Code
 * is skipped — it is literal by definition, and the `code` override handles
 * the paths inside it.
 */
export function rehypeInlineImages(options: {
  source: string;
  baseDir?: string | null;
}) {
  const walk = (node: HastNode): void => {
    if (!node.children || node.tagName === "code" || node.tagName === "pre") {
      return;
    }
    const out: HastNode[] = [];
    let changed = false;
    for (const child of node.children) {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (child.type === "text" && start !== undefined && end !== undefined) {
        const segments = splitImagePaths(
          options.source.slice(start, end),
          options.baseDir,
        );
        if (segments.some((seg) => seg.path)) {
          changed = true;
          for (const seg of segments) {
            out.push(
              seg.path
                ? {
                    type: "element",
                    tagName: "span",
                    properties: {
                      [IMAGE_PATH_PROP]: seg.path,
                      [IMAGE_LABEL_PROP]: seg.text,
                    },
                    children: [],
                  }
                : { type: "text", value: seg.text },
            );
          }
          continue;
        }
      }
      walk(child);
      out.push(child);
    }
    if (changed) node.children = out;
    groupGalleries(node, options.baseDir);
  };
  return (tree: HastNode) => walk(tree);
}

/** Class names the modern view's stylesheet lays out as a wrapping strip. */
export const GALLERY_CLASS = "modern-gallery";
export const GALLERY_CELL_CLASS = "modern-gallery-cell";

/**
 * Lays consecutive images side by side instead of one full-width block each:
 * a list whose every item shows an image becomes a gallery (items keep their
 * trailing prose as a caption), and a run of image-only paragraphs is wrapped
 * into one. Anything with prose of its own is left alone — a screenshot that
 * illustrates a sentence belongs next to that sentence.
 */
function groupGalleries(node: HastNode, baseDir?: string | null): void {
  const children = node.children;
  if (!children) return;

  if (node.tagName === "ul" || node.tagName === "ol") {
    const items = children.filter((c) => c.tagName === "li");
    if (items.length >= 2 && items.every((li) => hasImage(li, baseDir))) {
      node.tagName = "div";
      node.properties = { ...node.properties, className: [GALLERY_CLASS] };
      for (const li of items) {
        li.tagName = "div";
        li.properties = { ...li.properties, className: [GALLERY_CELL_CLASS] };
      }
      node.children = items;
    }
    return;
  }

  const out: HastNode[] = [];
  let run: HastNode[] = [];
  const flush = () => {
    if (run.length >= 2) {
      for (const p of run) {
        p.tagName = "div";
        p.properties = { ...p.properties, className: [GALLERY_CELL_CLASS] };
      }
      out.push({
        type: "element",
        tagName: "div",
        properties: { className: [GALLERY_CLASS] },
        children: run,
      });
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const child of children) {
    if (child.tagName === "p" && isImageOnly(child, baseDir)) {
      run.push(child);
      continue;
    }
    // Whitespace between two paragraphs must not break the run.
    if (run.length > 0 && child.type === "text" && !child.value?.trim()) {
      continue;
    }
    flush();
    out.push(child);
  }
  flush();
  if (out.length !== children.length) node.children = out;
}

/** Whether `node` shows an image: a marker, or inline code that is one path. */
function hasImage(node: HastNode, baseDir?: string | null): boolean {
  if (node.tagName === "pre") return false;
  if (node.properties?.[IMAGE_PATH_PROP] !== undefined) return true;
  if (node.tagName === "code") {
    const segments = splitImagePaths(textOf(node), baseDir);
    return segments.length === 1 && segments[0].path !== undefined;
  }
  return (node.children ?? []).some((child) => hasImage(child, baseDir));
}

/** Whether `node` holds images and nothing else that reads as prose. */
function isImageOnly(node: HastNode, baseDir?: string | null): boolean {
  let images = 0;
  for (const child of node.children ?? []) {
    if (child.type === "text") {
      if (child.value?.trim()) return false;
      continue;
    }
    if (!hasImage(child, baseDir)) return false;
    images++;
  }
  return images > 0;
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}
