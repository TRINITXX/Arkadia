// Detection of on-disk image paths mentioned in conversation text, so the
// modern view can try to render them inline. Absolute Windows paths only
// (tool inputs are near-always absolute; relative would need cwd plumbing).
// Videos count as images here: they show as a still of themselves and the
// lightbox plays them (`isVideoPath` tells them apart).

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
/** Mirrors `video_mime` in `src-tauri/src/media.rs`. Never `.ts`: TypeScript. */
const VIDEO_EXT_RE = /\.(?:mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g|ogv|3gp)$/i;

/**
 * One character of a path, for every pattern of absolute paths here (a `u`
 * one): anything Windows allows in a name but `:`, the backtick and `'`. An
 * apostrophe between two letters belongs to the name (Windows' own
 * `Capture d'écran ….png`); any other one closes a quote around the path.
 */
const NAME_CHAR = String.raw`(?:[^\n\r"'\x60<>|?*:]|(?<=\p{L})'(?=\p{L}))`;

/**
 * Absolute Windows paths ending in an image extension, both slash styles.
 * Spaces are allowed (`…\Claude Desktop\…` is a real project root): the match
 * is lazy from the drive letter to the first image extension, and `:` can only
 * follow the drive letter, so two paths on one line never merge. An extension
 * that goes on (`demo.mp4.png`, `clip.mov-frames\1.png`) is not the end. A prose
 * false positive (`C:\dir then shot.png`) just fails its probe silently.
 * Its characters: `NAME_CHAR`.
 */
const IMG_PATH_RE = new RegExp(
  String.raw`(?<![A-Za-z])[A-Za-z]:[\\/]${NAME_CHAR}*?\.(?:png|jpe?g|gif|webp|bmp|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g|ogv|3gp)\b(?![.-]\w)`,
  "giu",
);

/**
 * Absolute Windows paths to any file: lazy from the drive letter to the first
 * extension that ends a name, never a folder's (`v1.2\`), both slash styles.
 * Spaces are allowed, as in `IMG_PATH_RE`: a prose false positive
 * (`C:\proj holds app.ts`) fails its probe (`path_exists`) and stays text.
 */
const FILE_PATH_RE = new RegExp(
  String.raw`(?<![A-Za-z])[A-Za-z]:[\\/]${NAME_CHAR}*?\.[A-Za-z0-9]{1,8}(?![\w\\/])(?![.-]\w)`,
  "gu",
);

/**
 * `text` cut around the absolute paths of files other than images and videos
 * (those are `splitImagePaths`'), so the chat can draw each as a tag with its
 * name. Segments cover the whole input, in order.
 */
export function splitFilePaths(text: string): PathSegment[] {
  const out: PathSegment[] = [];
  let cursor = 0;
  for (const m of text.matchAll(FILE_PATH_RE)) {
    if (isImagePath(m[0]) || isVideoPath(m[0])) continue;
    if (m.index > cursor) out.push({ text: text.slice(cursor, m.index) });
    out.push({ text: m[0], path: m[0] });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length || out.length === 0) {
    out.push({ text: text.slice(cursor) });
  }
  return out;
}

/** `text` when it is one file's absolute path alone (`splitFilePaths`). */
export function filePathAlone(text: string): string | null {
  const segments = splitFilePaths(text.trim());
  return segments.length === 1 ? (segments[0].path ?? null) : null;
}

/** A whole absolute path, a `:line:col` suffix aside (`clickablePath`). */
const CLICKABLE_PATH_RE = new RegExp(
  String.raw`^([A-Za-z]:[\\/]${NAME_CHAR}+?)(?::\d+(?::\d+)?)?$`,
  "u",
);

/**
 * `text` when it is an absolute Windows path, whole (a `:line:col` suffix
 * stripped), else `null`: what a click on inline code or a tool's header
 * opens. Colons only follow the drive letter, so `https://…` never matches.
 */
export function clickablePath(text: string): string | null {
  const m = CLICKABLE_PATH_RE.exec(text.trim());
  return m ? m[1] : null;
}

/**
 * Relative image paths with at least one directory (`.screenshots/x.png`,
 * `docs\img\y.jpg`): bare names like `shot.png` are too ambiguous to probe.
 * No spaces, and the lookbehind keeps it from starting inside an absolute path
 * or a URL (`C:\a\b.png`, `https://x/y.png`).
 */
const REL_IMG_PATH_RE =
  /(?<![\w.\\/:~-])(?:[\w.-]+[\\/])+[\w.-]+\.(?:png|jpe?g|gif|webp|bmp|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g|ogv|3gp)\b/gi;

/** How a path is compared: case and slash style ignored. */
export function imagePathKey(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

/** True when `path` looks like an absolute Windows path to an image file. */
export function isImagePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) && IMAGE_EXT_RE.test(path.trim());
}

/** True when `path` looks like an absolute Windows path to a video file. */
export function isVideoPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) && VIDEO_EXT_RE.test(path.trim());
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
    const key = imagePathKey(path);
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
