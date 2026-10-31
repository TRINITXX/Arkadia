import { messageCards } from "@/lib/chat/chatAttachments";
import type { ChatItem } from "@/lib/chat/chatState";
import type { ImageRef } from "@/lib/imageGallery";
import {
  imagePathKey,
  isImagePath,
  isVideoPath,
  splitImagePaths,
} from "@/lib/imagePaths";

/**
 * The chat's images: under each message a strip of what was pasted in it and
 * of the image files its text names, the user's or Claude's, the images
 * Claude reads; and all of them in reading order, which the lightbox's ←/→
 * walk.
 */

/** A pasted image has no file: the strip and the lightbox name it so. */
export function pastedName(n: number): string {
  return `Image collée ${n}`;
}

/** Image paths per message text, so a streamed reply re-reads only itself. */
const mentions = new WeakMap<
  ChatItem,
  { cwd: string | null; paths: string[] }
>();

/** A message's strip shows at most this many files it names. */
const MAX_NAMED = 12;

function mentionedPaths(item: ChatItem, cwd: string | null): string[] {
  if (item.kind !== "text") return [];
  const cached = mentions.get(item);
  if (cached && cached.cwd === cwd) return cached.paths;
  // As the markdown marks them: a path under a folder with a space
  // (`…\Claude Desktop\x.png`) is one mention, not also a relative one.
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const { path } of splitImagePaths(item.text, cwd)) {
    if (!path || seen.has(imagePathKey(path))) continue;
    seen.add(imagePathKey(path));
    if (paths.push(path) >= MAX_NAMED) break;
  }
  mentions.set(item, { cwd, paths });
  return paths;
}

/** A user message as its frame shows it (`messageCards`), by item. */
const userViews = new WeakMap<
  ChatItem,
  { cwd: string | null; view: UserMessageView }
>();

export interface UserMessageView {
  /** The text left once the attached files are cards. */
  text: string;
  /** The files it attaches or quotes. */
  paths: string[];
  /** The image and video files its prose names, left in the text: only
   *  those found get a thumbnail (a match can run over words). */
  named: string[];
}

/**
 * The user's message without its attached files (`messageCards`), the
 * cards' paths, and the images its prose names.
 */
export function userMessageView(
  item: ChatItem,
  cwd: string | null,
): UserMessageView {
  if (item.kind !== "user") return { text: "", paths: [], named: [] };
  const cached = userViews.get(item);
  if (cached && cached.cwd === cwd) return cached.view;
  const cards = messageCards(item.text);
  const seen = new Set(cards.paths.map(imagePathKey));
  const named: string[] = [];
  for (const { path } of splitImagePaths(cards.text, cwd)) {
    if (!path || seen.has(imagePathKey(path))) continue;
    seen.add(imagePathKey(path));
    if (named.push(path) >= MAX_NAMED) break;
  }
  const view = { text: cards.text, paths: cards.paths, named };
  userViews.set(item, { cwd, view });
  return view;
}

/** The image a `Read` call reads, if it is one. */
export function readImagePath(item: ChatItem): string | null {
  if (item.kind !== "tool" || item.name !== "Read") return null;
  const path = item.input.file_path;
  return typeof path === "string" && isImagePath(path) ? path : null;
}

export interface ChatGallery {
  /** Every image once, in reading order. */
  all: ImageRef[];
  /** Each message's strip, by item id: pasted first, then the paths named. */
  byItem: Map<string, ImageRef[]>;
}

export function chatGallery(
  items: ChatItem[],
  cwd: string | null,
): ChatGallery {
  const all: ImageRef[] = [];
  const byItem = new Map<string, ImageRef[]>();
  const seen = new Set<string>();
  let pasted = 0;
  for (const item of items) {
    const refs: ImageRef[] = [];
    if (item.kind === "user") {
      // Counted even when dropped from memory: names stay put as images go.
      const kept = item.pasted ?? [];
      const firstKept = pasted + item.images - kept.length;
      kept.forEach((url, i) =>
        refs.push({ path: pastedName(firstKept + i + 1), url }),
      );
      pasted += item.images;
      // Its cards: the images and videos among them.
      const view = userMessageView(item, cwd);
      for (const path of [...view.paths, ...view.named]) {
        if (isImagePath(path) || isVideoPath(path)) refs.push({ path });
      }
    }
    for (const path of mentionedPaths(item, cwd)) refs.push({ path });
    const read = readImagePath(item);
    if (read) refs.push({ path: read });
    if (refs.length === 0) continue;
    byItem.set(item.id, refs);
    for (const ref of refs) {
      const key = imagePathKey(ref.path);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(ref);
    }
  }
  return { all, byItem };
}
