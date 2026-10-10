import { invoke } from "@tauri-apps/api/core";

/**
 * Shared path → object-URL cache for on-disk images fetched over IPC.
 *
 * Failures are cached too, so a non-existent path mentioned in prose is probed
 * exactly once. LRU-ish capped: the oldest entry is revoked when full, which
 * keeps a long reading session (or many photo-picker scrolls) from pinning
 * every image it ever showed in memory.
 */
const urlCache = new Map<string, Promise<string | null>>();
const URL_CACHE_MAX = 80;

/**
 * Thumbnails get their own, larger cache. The file picker can hold up to a
 * thousand tiles at ~15 KB each, and scrolling through them must neither
 * evict a thumbnail still loading — its tile would then render a revoked URL —
 * nor push the conversation's full-size images out of the cache above.
 */
const thumbCache = new Map<string, Promise<string | null>>();
const THUMB_CACHE_MAX = 1000;

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
  return fetchVia(urlCache, URL_CACHE_MAX, "read_image_bytes", path, mediaType);
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
  return fetchVia(
    thumbCache,
    THUMB_CACHE_MAX,
    "photo_thumbnail",
    path,
    "image/jpeg",
    version,
  );
}

function fetchVia(
  cache: Map<string, Promise<string | null>>,
  max: number,
  command: string,
  path: string,
  mediaType?: string,
  version?: number,
): Promise<string | null> {
  // Namespaced by command: the full image and the thumbnail of one path are two
  // different blobs and must not share an entry.
  const key = `${command} ${path} ${version ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = invoke<ArrayBuffer | number[]>(command, { path })
    .then((data) => {
      // Raw bytes arrive as an ArrayBuffer over Tauri's IPC protocol, but as a
      // plain number array once one IPC fetch has failed and the window falls
      // back to postMessage for good: blobbed as is, that array is the text
      // "255,216,…" and every image fetched from then on comes out broken.
      const buf = data instanceof ArrayBuffer ? data : new Uint8Array(data);
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const type = mediaType ?? MIME_FOR_EXT[ext] ?? "image/png";
      return URL.createObjectURL(new Blob([buf], { type }));
    })
    .catch(() => null);
  if (cache.size >= max) {
    const [oldestKey, oldest] = cache.entries().next().value!;
    cache.delete(oldestKey);
    void oldest.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  cache.set(key, promise);
  return promise;
}
