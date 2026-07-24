// Detection of on-disk image paths mentioned in conversation text, so the
// modern view can try to render them inline. Absolute Windows paths only
// (tool inputs are near-always absolute; relative would need cwd plumbing).

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

/**
 * Absolute Windows paths ending in an image extension. Pragmatic: no spaces
 * (a path in prose is rarely quoted, and space-splitting false positives are
 * worse than missing exotic paths), both slash styles.
 */
const IMG_PATH_RE =
  /[A-Za-z]:[\\/](?:[^\s"'<>|?*:]+[\\/])*[^\s"'<>|?*:]+\.(?:png|jpe?g|gif|webp|bmp)\b/gi;

/** True when `path` looks like an absolute Windows path to an image file. */
export function isImagePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) && IMAGE_EXT_RE.test(path.trim());
}

/**
 * The image paths mentioned in `text`, deduped, capped at `max`. Non-existent
 * candidates are fine — probing happens at fetch time and fails silently.
 */
export function findImagePaths(text: string, max = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(IMG_PATH_RE)) {
    const path = match[0];
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}
