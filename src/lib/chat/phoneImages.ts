import type { ToolItem } from "@/lib/chat/chatGroups";
import { chatGallery, readImagePath } from "@/lib/chat/chatImages";
import type { ChatItem } from "@/lib/chat/chatState";
import type { ImageRef } from "@/lib/imageRef";
import { imagePathKey, isVideoPath } from "@/lib/imagePaths";

/**
 * The chat's images on the iPhone (`chatImages`). The phone reads a PC file
 * through the PC's `/image` route, which serves images only: videos stay
 * out. It knows no working folder: absolute paths only.
 */

const NONE: readonly string[] = [];

/** By item: a row redrawn reads its paths again for nothing. */
const named = new WeakMap<ChatItem, readonly string[]>();

/**
 * The image files a message names or attaches (the user's, Claude's), or a
 * `Read` reads: the thumbnails under it. The phone's markdown draws no
 * minis in the prose: every one shows there.
 */
export function itemImagePaths(item: ChatItem): readonly string[] {
  const cached = named.get(item);
  if (cached) return cached;
  const refs = chatGallery([item], null).byItem.get(item.id) ?? [];
  const paths = refs
    .filter((ref) => !ref.url && !isVideoPath(ref.path))
    .map((ref) => ref.path);
  const out = paths.length > 0 ? paths : NONE;
  named.set(item, out);
  return out;
}

/** A line shows at most this many of the images read (`ChatReadThumbs`). */
const MAX_READ = 4;

/** The latest images these calls read, each once, in their order. */
export function readImages(tools: readonly ToolItem[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = tools.length - 1; i >= 0; i--) {
    const path = readImagePath(tools[i]);
    if (!path || seen.has(imagePathKey(path))) continue;
    seen.add(imagePathKey(path));
    if (out.unshift(path) >= MAX_READ) break;
  }
  return out.length > 0 ? out : NONE;
}

/** Every image of the chat once, in reading order: what the viewer walks. */
export function viewerImages(items: ChatItem[]): ImageRef[] {
  return chatGallery(items, null).all.filter(
    (ref) => !!ref.url || !isVideoPath(ref.path),
  );
}

/** Where an image sits among the viewer's: a pasted one by its data, a
 *  file by its path (case and slashes aside); -1 when not there. */
export function viewerIndex(
  list: readonly ImageRef[],
  image: ImageRef,
): number {
  if (image.url) return list.findIndex((ref) => ref.url === image.url);
  const key = imagePathKey(image.path);
  return list.findIndex((ref) => !ref.url && imagePathKey(ref.path) === key);
}
