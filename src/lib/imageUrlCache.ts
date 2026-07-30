import { invoke } from "@tauri-apps/api/core";

/**
 * Shared path → object-URL cache for on-disk images fetched over IPC.
 *
 * Failures are cached too, so a non-existent path mentioned in prose is probed
 * exactly once. LRU-ish capped: the oldest entry is revoked when full, which
 * keeps a long reading session (or many photo-picker openings) from pinning
 * every image it ever showed in memory.
 */
const urlCache = new Map<string, Promise<string | null>>();
const URL_CACHE_MAX = 80;

const MIME_FOR_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export function fetchImageUrl(
  path: string,
  mediaType?: string,
): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  const promise = invoke<ArrayBuffer>("read_image_bytes", { path })
    .then((buf) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const type = mediaType ?? MIME_FOR_EXT[ext] ?? "image/png";
      return URL.createObjectURL(new Blob([buf], { type }));
    })
    .catch(() => null);
  if (urlCache.size >= URL_CACHE_MAX) {
    const [oldestKey, oldest] = urlCache.entries().next().value!;
    urlCache.delete(oldestKey);
    void oldest.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  urlCache.set(path, promise);
  return promise;
}
