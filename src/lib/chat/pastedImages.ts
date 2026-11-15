import type { DraftImage } from "@/lib/chat/chatDrafts";
import type { ChatImage } from "@/lib/chat/useChatSession";

/**
 * Images pasted into a field (Ctrl+V), as the input takes them: numbered,
 * their tag « [Image #n] » at the caret, so Claude knows which one the text
 * means. The input (`ChatComposer`), the question sheet's fields, the
 * « Autre réponse » of Claude's questions (the user's ask of 15/11/2026).
 */

export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const IMAGE_TAG = /\[Image #(\d+)\]/g;

/** The image files of a paste, in their order; none: a text paste. */
export function pastedImageFiles(data: DataTransfer | null): File[] {
  return data
    ? [...data.files].filter((f) => IMAGE_TYPES.includes(f.type))
    : [];
}

export function readImage(file: File): Promise<DraftImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({
        id: `${file.name}-${file.size}-${Math.random()}`,
        url,
        mediaType: file.type,
        data: url.slice(url.indexOf(",") + 1),
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** The image numbers a text's tags give, in order, once each. */
export const imageTags = (text: string): number[] => [
  ...new Set([...text.matchAll(IMAGE_TAG)].map((m) => Number(m[1]))),
];

/** The last number in use, the images' and the texts' tags: never two « [Image #2] ». */
export function lastImageNumber(
  texts: readonly string[],
  images: readonly { n?: number }[],
): number {
  return Math.max(
    0,
    ...images.map((img) => img.n ?? 0),
    ...texts.flatMap(imageTags),
  );
}

/**
 * Images numbered after `last`, their tags put in place of the selection
 * (`start`…`end`); `caret`: just after the tags.
 */
export function withImageTags(
  text: string,
  start: number,
  end: number,
  images: readonly DraftImage[],
  last: number,
): { text: string; images: DraftImage[]; caret: number } {
  let n = last;
  const added = images.map((img) => ({ ...img, n: ++n }));
  const tags = added.map((img) => `[Image #${img.n}]`).join(" ");
  const at = Math.max(0, Math.min(start, text.length));
  const to = Math.min(Math.max(end, at), text.length);
  return {
    text: text.slice(0, at) + tags + text.slice(to),
    images: added,
    caret: at + tags.length,
  };
}

/** An image removed: its tag goes with it, no « [Image #2] » for nothing. */
export function withoutImageTag(text: string, n: number | undefined): string {
  return n ? text.split(`[Image #${n}]`).join("") : text;
}

/** A text's own images, each tag there: one the user erased comes back at its end. */
export function withEveryTag(
  text: string,
  images: readonly DraftImage[],
): string {
  const named = new Set(imageTags(text));
  const missing = images
    .filter((img) => img.n && !named.has(img.n))
    .map((img) => `[Image #${img.n}]`);
  if (missing.length === 0) return text;
  const body = text.trimEnd();
  return body ? `${body} ${missing.join(" ")}` : missing.join(" ");
}

/** As sent to Claude: « Image #n » said just before each. */
export function sentImages(images: readonly DraftImage[]): ChatImage[] {
  return images.map(({ mediaType, data, n }) => ({
    mediaType,
    data,
    ...(n ? { label: `Image #${n}` } : {}),
  }));
}
