// Which images a conversation block shows, shared by the thumbnails and the
// lightbox gallery so that arrow navigation walks exactly what is on screen.

import { invoke } from "@tauri-apps/api/core";
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

/**
 * What a message's thumbnail strip still has to show, now that prose mentions
 * render as images where they are written: the turn's pasted images, plus the
 * paths that sit inside a fenced code block, which is left verbatim.
 */
export function messageStripImages(
  block: ConvBlock,
  baseDir?: string | null,
): ImageRef[] {
  const pasted = (block.images ?? []).map((img) => ({
    path: img.path,
    mediaType: img.media_type,
  }));
  if (pasted.length > 0 || !block.text) return pasted;
  const inline = new Set(
    findImagePaths(withoutFences(block.text), undefined, baseDir).map((p) =>
      p.toLowerCase(),
    ),
  );
  return findImagePaths(block.text, undefined, baseDir)
    .filter((p) => !inline.has(p.toLowerCase()))
    .map((path) => ({ path }));
}

/** `text` with its fenced code blocks removed (an unclosed fence is kept). */
function withoutFences(text: string): string {
  return text.replace(/^ *(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ *\1[^\n]*$/gm, "");
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

/**
 * Every image of a pane's Claude conversation, read from its transcript: what
 * the terminal's lightbox arrows walk. Thinking is left out (the terminal does
 * not show it); tool results count. Empty when the pane has no conversation.
 */
export async function loadPaneGallery(paneId: string): Promise<ImageRef[]> {
  try {
    const d = await invoke<{ blocks: ConvBlock[]; cwd?: string | null }>(
      "read_conversation_delta",
      { paneId, generation: 0, have: 0 },
    );
    return galleryImages(
      d.blocks.filter((b) => b.kind !== "thinking"),
      true,
      d.cwd,
    );
  } catch {
    return [];
  }
}

/** `path` as `gallery` spells it, ignoring case and slash style; else null. */
export function galleryPathOf(
  gallery: ImageRef[],
  path: string,
): string | null {
  const key = (p: string) => p.replace(/\//g, "\\").toLowerCase();
  const want = key(path);
  return gallery.find((g) => key(g.path) === want)?.path ?? null;
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
