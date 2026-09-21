// Which images a conversation block shows, shared by the thumbnails and the
// lightbox gallery so that arrow navigation walks exactly what is on screen.

import type { ConvBlock } from "@/components/ModernConversationView";
import { findImagePaths } from "@/lib/imagePaths";

/** One displayable image: a transcript image or an on-disk path. */
export interface ImageRef {
  path: string;
  mediaType?: string;
}

/**
 * A message's images: the ones pasted in the turn, else the on-disk image
 * paths its text mentions. `baseDir` (the session's working directory)
 * resolves relative mentions like `.screenshots/x.png`.
 */
export function messageImages(
  block: ConvBlock,
  baseDir?: string | null,
): ImageRef[] {
  const pasted = (block.images ?? []).map((img) => ({
    path: img.path,
    mediaType: img.media_type,
  }));
  if (pasted.length > 0 || !block.text) return pasted;
  return findImagePaths(block.text, undefined, baseDir).map((path) => ({
    path,
  }));
}

/**
 * A tool card's images: the tool_result's own images, else the image paths
 * named by its `file_path`/`path` input or mentioned in its output. The output
 * side only counts when results are shown, like the card itself.
 */
export function toolImages(
  block: ConvBlock,
  showResults: boolean,
  baseDir?: string | null,
): ImageRef[] {
  const outputImages = showResults ? (block.tool_output_images ?? []) : [];
  if (outputImages.length > 0) {
    return outputImages.map((img) => ({
      path: img.path,
      mediaType: img.media_type,
    }));
  }
  const candidates = new Set<string>();
  const input = parseInput(block.tool_input);
  for (const key of ["file_path", "path"]) {
    const v = input[key];
    if (typeof v === "string") {
      for (const p of findImagePaths(v, 1, baseDir)) candidates.add(p);
    }
  }
  const output = showResults ? (block.tool_output ?? "") : "";
  if (output) {
    for (const p of findImagePaths(output, undefined, baseDir)) {
      candidates.add(p);
    }
  }
  return [...candidates].map((path) => ({ path }));
}

/** Every image of `blocks`, in reading order, each path once (first wins). */
export function galleryImages(
  blocks: ConvBlock[],
  showResults: boolean,
  baseDir?: string | null,
): ImageRef[] {
  const out: ImageRef[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const refs =
      b.kind === "tool"
        ? toolImages(b, showResults, baseDir)
        : messageImages(b, baseDir);
    for (const ref of refs) {
      const key = ref.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

function parseInput(json?: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
