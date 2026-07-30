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
  return fetchVia("read_image_bytes", path, mediaType);
}

/**
 * Same, but served by the backend's downscaled JPEG. Use it wherever the image
 * is displayed small: the camera roll's full-resolution captures cost ~14 MB of
 * decoded bitmap each, against ~15 KB for a thumbnail.
 *
 * `version` should be the photo's mtime, so a file edited in place gets a fresh
 * entry instead of the thumbnail of its previous content.
 */
export function fetchThumbnailUrl(
  path: string,
  version?: number,
): Promise<string | null> {
  return fetchVia("photo_thumbnail", path, "image/jpeg", version);
}

function fetchVia(
  command: string,
  path: string,
  mediaType?: string,
  version?: number,
): Promise<string | null> {
  // Namespaced by command: the full image and the thumbnail of one path are two
  // different blobs and must not share an entry.
  const key = `${command} ${path} ${version ?? ""}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const promise = invoke<ArrayBuffer>(command, { path })
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
  urlCache.set(key, promise);
  return promise;
}
