// Detection of on-disk image paths mentioned in conversation text, so the
// modern view can try to render them inline. Absolute Windows paths only
// (tool inputs are near-always absolute; relative would need cwd plumbing).

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

/**
 * Absolute Windows paths ending in an image extension, both slash styles.
 * Spaces are allowed (`…\Claude Desktop\…` is a real project root): the match
 * is lazy from the drive letter to the first image extension, and `:` can only
 * follow the drive letter, so two paths on one line never merge. A prose
 * false positive (`C:\dir then shot.png`) just fails its probe silently.
 */
const IMG_PATH_RE =
  /(?<![A-Za-z])[A-Za-z]:[\\/][^\n\r"'`<>|?*:]*?\.(?:png|jpe?g|gif|webp|bmp)\b/gi;

/**
 * Relative image paths with at least one directory (`.screenshots/x.png`,
 * `docs\img\y.jpg`): bare names like `shot.png` are too ambiguous to probe.
 * No spaces, and the lookbehind keeps it from starting inside an absolute path
 * or a URL (`C:\a\b.png`, `https://x/y.png`).
 */
const REL_IMG_PATH_RE =
  /(?<![\w.\\/:~-])(?:[\w.-]+[\\/])+[\w.-]+\.(?:png|jpe?g|gif|webp|bmp)\b/gi;

/** True when `path` looks like an absolute Windows path to an image file. */
export function isImagePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) && IMAGE_EXT_RE.test(path.trim());
}

/**
 * The image paths mentioned in `text`, in order of appearance, deduped, capped
 * at `max`. With `baseDir` (the session's working directory), relative paths
 * are resolved against it too, so `.screenshots/x.png` and its absolute
 * spelling count once. Non-existent candidates are fine — probing happens at
 * fetch time and fails silently.
 */
export function findImagePaths(
  text: string,
  max = 12,
  baseDir?: string | null,
): string[] {
  const found: { at: number; path: string }[] = [];
  for (const m of text.matchAll(IMG_PATH_RE)) {
    found.push({ at: m.index, path: m[0] });
  }
  if (baseDir) {
    for (const m of text.matchAll(REL_IMG_PATH_RE)) {
      found.push({ at: m.index, path: resolveRelative(baseDir, m[0]) });
    }
    found.sort((a, b) => a.at - b.at);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { path } of found) {
    const key = path.replace(/\//g, "\\").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}

/** A run of text, or one image path mention (`path` = resolved, `text` = as written). */
export interface PathSegment {
  text: string;
  path?: string;
}

/**
 * `text` cut around the image paths it mentions, so a renderer can swap each
 * mention for the image itself and leave the prose alone. Segments cover the
 * whole input, in order; a text with no mention yields a single segment.
 */
export function splitImagePaths(
  text: string,
  baseDir?: string | null,
): PathSegment[] {
  const hits: { at: number; raw: string; path: string }[] = [];
  for (const m of text.matchAll(IMG_PATH_RE)) {
    hits.push({ at: m.index, raw: m[0], path: m[0] });
  }
  if (baseDir) {
    for (const m of text.matchAll(REL_IMG_PATH_RE)) {
      hits.push({
        at: m.index,
        raw: m[0],
        path: resolveRelative(baseDir, m[0]),
      });
    }
    hits.sort((a, b) => a.at - b.at);
  }
  const out: PathSegment[] = [];
  let cursor = 0;
  for (const hit of hits) {
    // A relative match inside an absolute one (or the reverse) is already covered.
    if (hit.at < cursor) continue;
    if (hit.at > cursor) out.push({ text: text.slice(cursor, hit.at) });
    out.push({ text: hit.raw, path: hit.path });
    cursor = hit.at + hit.raw.length;
  }
  if (cursor < text.length || out.length === 0) {
    out.push({ text: text.slice(cursor) });
  }
  return out;
}

/** `rel` joined onto `baseDir` with Windows separators; `./` is dropped. */
export function resolveRelative(baseDir: string, rel: string): string {
  const base = baseDir.replace(/[\\/]+$/, "");
  const tail = rel.replace(/^(?:\.[\\/])+/, "").replace(/\//g, "\\");
  return `${base}\\${tail}`;
}
