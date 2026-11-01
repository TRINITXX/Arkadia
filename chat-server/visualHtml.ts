// The pure side of the chat's visuals (`show_visual`, `visual.ts`): which
// local images a page names, whether a file's bytes really are an image, and
// what the tool answers Claude from the page's report. No file is read here.

/** The in-process MCP server of every chat, and its one tool. */
export const VISUAL_SERVER = "arkadia";
export const VISUAL_TOOL = "show_visual";
/** As Claude Code names it in a tool call (`mcp__<server>__<tool>`). */
export const VISUAL_TOOL_NAME = `mcp__${VISUAL_SERVER}__${VISUAL_TOOL}`;

/**
 * A visual fits the chat's height (Alexis, 31/10/2026: « les visuels rentrent
 * dans une fenêtre en hauteur sans que j'aie besoin de scroller »). The card
 * fits its images to the room it has, then scales the whole page down to
 * `VISUAL_FIT_FLOOR` at most (smaller would no longer read well); past
 * that, the conversation scrolls. The probe renders with this room, about
 * what a pane shows, and Claude reads it in the tool's description.
 */
export const VISUAL_FIT_HEIGHT = 700;
export const VISUAL_FIT_FLOOR = 0.75;

/** How the result of a page Arkadia checked clean opens (`visualVerified`). */
export const VISUAL_CHECKED_CLEAN = "Shown in the chat (checked: no error";

/** The page Claude writes, before its images go in. */
export const VISUAL_HTML_MAX = 512_000;
export const VISUAL_TITLE_MAX = 120;
/** One local image, and all of a page's, inlined as data URLs. */
export const VISUAL_IMAGE_MAX = 8 * 1024 * 1024;
export const VISUAL_IMAGES_MAX = 24 * 1024 * 1024;
/**
 * The page with its images in, as it travels (stdout, the Tauri event, the
 * frame's postMessage): the page itself plus its images in base64, once.
 */
export const VISUAL_PAGE_MAX = VISUAL_HTML_MAX + Math.ceil((VISUAL_IMAGES_MAX * 4) / 3) + 4096;

/** A local image a page names: the text it wrote, and the file it means. */
export interface LocalImageRef {
  raw: string;
  path: string;
  /** How many image places name it: each gets the whole data URL. */
  mentions: number;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0" };

/** `&#39;`, `&apos;`, `&quot;`… as the browser reads an attribute. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

/**
 * An absolute path on a drive letter, as written or as a `file:` URL. Never
 * a share (`\\server\…`): reading it would connect the PC to another machine
 * (REVIEW.md, « Fichier du PC lu pour une vue »). An apostrophe or brackets
 * belong to the name (« Capture d'écran … », « photo (1).png »).
 */
export function localPathOf(value: string): string | null {
  let v = decodeEntities(value.trim());
  // `url(&quot;C:/a.png&quot;)` in a style attribute: its quotes, decoded.
  const quoted = /^(["'])(.*)\1$/.exec(v);
  if (quoted) v = quoted[2];
  if (/^file:/i.test(v)) {
    v = v.replace(/^file:\/*/i, "");
    try {
      v = decodeURIComponent(v);
    } catch {
      return null;
    }
  }
  return /^[A-Za-z]:[\\/]/.test(v) && !/[\r\n<>"|?*]/.test(v.slice(2)) ? v : null;
}

/** Where a page names an image: a stretch of its text, and that text. */
interface Spot {
  start: number;
  raw: string;
}

/**
 * What is text, not markup, to the parser: comments, scripts and the raw
 * text elements. Blanked (same length, so offsets hold) before any search:
 * `'<img src="C:/a.png">'` in a script string is no image.
 */
const RAW_TEXT_RE =
  /<!--[\s\S]*?(?:-->|$)|<(script|textarea|title|xmp|noscript|noembed|noframes)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
/** Any start tag; its attributes may hold `>` in quotes. */
const TAG_RE = /<([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
/** A `<style>` element's sheet. */
const STYLE_RE = /(<style\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(?:<\/style\s*>|$)/gi;
/** An attribute and its value, each quote up to its own: `"l'été"` keeps its apostrophe. */
const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** CSS `url()`, quoted (anything up to the same quote) or not (up to the `)` that ends it). */
const CSS_URL_QUOTED_RE = /url\(\s*(["'])(.*?)\1\s*\)/gis;
const CSS_URL_BARE_RE = /url\(\s*(?!["'\s])([^"\r\n]*?)\s*\)(?=[\s;,}"'!)]|$)/gi;

const blank = (html: string) => html.replace(RAW_TEXT_RE, (m) => " ".repeat(m.length));

/**
 * Which attributes of a tag load an image: an `<a>`, a `<video src>`, a
 * `<source src>` of a video or a script are left alone, whatever they name.
 */
function imageAttrs(tag: string, attrs: Map<string, string>): string[] {
  switch (tag) {
    case "img":
      return ["src", "srcset"];
    case "source":
      return ["srcset"];
    case "image":
    case "feimage":
      return ["href", "xlink:href"];
    case "video":
      return ["poster"];
    case "input":
      return attrs.get("type")?.toLowerCase() === "image" ? ["src"] : [];
    case "link":
      return /\bicon\b/i.test(attrs.get("rel") ?? "") ? ["href"] : [];
    default:
      return [];
  }
}

/** The `url()`s of a stretch of CSS that starts at `at` in the page. */
function cssSpots(css: string, at: number): Spot[] {
  const spots: Spot[] = [];
  for (const m of css.matchAll(CSS_URL_QUOTED_RE)) {
    spots.push({ raw: m[2], start: at + (m.index ?? 0) + m[0].indexOf(m[1]) + 1 });
  }
  for (const m of css.matchAll(CSS_URL_BARE_RE)) {
    spots.push({ raw: m[1], start: at + (m.index ?? 0) + m[0].indexOf(m[1], 4) });
  }
  return spots;
}

/**
 * Every image place of the page, in order: image attributes of the tags
 * that load one, and `url()` in CSS (a `<style>` sheet, a `style`
 * attribute) only. Text, scripts and comments never count: a path written
 * there stays text.
 */
function imageSpots(html: string): Spot[] {
  const markup = blank(html);
  const spots: Spot[] = [];
  for (const tag of markup.matchAll(TAG_RE)) {
    const name = tag[1].toLowerCase();
    const attrsAt = (tag.index ?? 0) + 1 + tag[1].length;
    const found = new Map<string, { raw: string; start: number }>();
    for (const a of tag[2].matchAll(ATTR_RE)) {
      const raw = a[2] ?? a[3] ?? "";
      // The value ends just before the closing quote.
      const start = attrsAt + (a.index ?? 0) + a[0].length - 1 - raw.length;
      found.set(a[1].toLowerCase(), { raw, start });
    }
    const style = found.get("style");
    if (style) spots.push(...cssSpots(style.raw, style.start));
    const values = new Map([...found].map(([k, v]) => [k, v.raw]));
    for (const key of imageAttrs(name, values)) {
      const value = found.get(key);
      if (!value) continue;
      if (key !== "srcset") {
        spots.push(value);
        continue;
      }
      // Each candidate's URL, before its width or density.
      let offset = 0;
      for (const part of value.raw.split(",")) {
        const url = part.trim().split(/\s+/)[0] ?? "";
        if (url) spots.push({ raw: url, start: value.start + offset + part.indexOf(url) });
        offset += part.length + 1;
      }
    }
  }
  for (const m of markup.matchAll(STYLE_RE)) {
    spots.push(...cssSpots(m[2], (m.index ?? 0) + m[1].length));
  }
  return spots.filter((s) => localPathOf(s.raw)).sort((a, b) => a.start - b.start);
}

/**
 * Every distinct local image the page names, in order of first mention,
 * with how many times: each mention gets the whole data URL.
 */
export function localImageRefs(html: string): LocalImageRef[] {
  const seen = new Map<string, LocalImageRef>();
  for (const { raw } of imageSpots(html)) {
    const known = seen.get(raw);
    if (known) known.mentions += 1;
    else {
      const path = localPathOf(raw);
      if (path) seen.set(raw, { raw, path, mentions: 1 });
    }
  }
  return [...seen.values()];
}

/**
 * The page with each local image named in an image place replaced by its
 * data URL (`urls`, by the text written). A path quoted in the page's text,
 * or linked by an `<a>`, stays as it is.
 */
export function withImages(html: string, urls: Map<string, string>): string {
  if (urls.size === 0) return html;
  let out = html;
  for (const { raw, start } of imageSpots(html).reverse()) {
    const url = urls.get(raw);
    if (url) out = `${out.slice(0, start)}${url}${out.slice(start + raw.length)}`;
  }
  return out;
}

const startsWith = (bytes: Uint8Array, sig: number[], at = 0) =>
  sig.every((b, i) => bytes[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * The image type the bytes say, never the file's name: a renamed text file
 * or executable gets no data URL. SVG is text: it must open on `<svg`.
 */
export function imageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("ftypavif"), 4) || startsWith(bytes, ascii("ftypavis"), 4)) return "image/avif";
  if (startsWith(bytes, ascii("BM")) && bytes.length > 26) return "image/bmp";
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) && bytes.length > 6) return "image/x-icon";
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 2048))
    .replace(/^\uFEFF/, "")
    .replace(/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?/i, "");
  return /^<svg[\s>]/i.test(head) ? "image/svg+xml" : null;
}

/** A local image left as it was, and why: said to Claude in the result. */
export interface SkippedImage {
  path: string;
  reason: string;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} Mo`;

/**
 * Whether a file goes in: its size first (nothing read past the caps), then
 * its first bytes. `total` is what the page's earlier images already weigh.
 */
export function imageVerdict(
  size: number,
  total: number,
  head: Uint8Array | null,
  mentions = 1,
): { mime: string } | { reason: string } {
  if (size > VISUAL_IMAGE_MAX) return { reason: `too large (${mb(size)}, max ${mb(VISUAL_IMAGE_MAX)})` };
  // Each mention carries the whole image: three mentions weigh three times.
  if (total + size * mentions > VISUAL_IMAGES_MAX) {
    return {
      reason: `the page's images exceed ${mb(VISUAL_IMAGES_MAX)} together${mentions > 1 ? ` (named ${mentions} times: each mention carries the whole image)` : ""}`,
    };
  }
  const mime = head ? imageMime(head) : null;
  return mime ? { mime } : { reason: "not an image (its bytes say so)" };
}

/**
 * Why the page with its images in can't be shown, or null: past
 * `VISUAL_PAGE_MAX` it would not travel (the caps on images make it rare).
 */
export function pageSizeError(prepared: string): string | null {
  if (prepared.length <= VISUAL_PAGE_MAX) return null;
  return `Not shown: the page weighs ${mb(prepared.length)} with its images in, past ${mb(VISUAL_PAGE_MAX)}. Use fewer or smaller local images, each named once (reuse it with CSS rather than repeating its path).`;
}

/** The kept copies of past visuals (`visual.ts`): 30 days, 400 Mo at most. */
export const VISUAL_STORE_DAYS = 30;
export const VISUAL_STORE_MAX = 400 * 1024 * 1024;

/**
 * The kept copies to delete: older than `VISUAL_STORE_DAYS`, then the
 * oldest until the rest fits in `VISUAL_STORE_MAX`. A resumed chat whose
 * copy went shows the call's own page (its local images by path).
 */
export function staleVisualFiles(
  files: { name: string; mtimeMs: number; size: number }[],
  now: number,
): string[] {
  const maxAge = VISUAL_STORE_DAYS * 86_400_000;
  const kept = files.filter((f) => now - f.mtimeMs <= maxAge).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const stale = new Set(files.filter((f) => now - f.mtimeMs > maxAge).map((f) => f.name));
  let total = 0;
  for (const f of kept) {
    total += f.size;
    if (total > VISUAL_STORE_MAX) stale.add(f.name);
  }
  return [...stale];
}

/** What the page measured and caught while it rendered (`chatVisual.ts`). */
export interface VisualReport {
  /** Uncaught errors and unhandled rejections, with their line. */
  errors: string[];
  /** The page's own `console.error` calls. */
  consoleErrors: string[];
  /** What it could not load: refused by the CSP, or failed (image, script). */
  blocked: string[];
  /** Its content's height and width, and how wide it really draws. */
  height: number;
  width: number;
  scrollWidth: number;
  /** Nothing visible: no text, no image, canvas, svg or video with a size. */
  empty: boolean;
  /** Its height follows the frame's (vh units, height:100% on html/body). */
  followsFrame: boolean;
  /** Still loading when the check ended (a slow CDN). */
  unfinished?: boolean;
}

/** A report as the page sent it, its lists and figures checked; null if not one. */
export function readVisualReport(value: unknown): VisualReport | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const list = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, 20) : [];
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0);
  if (typeof v.height !== "number") return null;
  return {
    errors: list(v.errors),
    consoleErrors: list(v.consoleErrors),
    blocked: list(v.blocked),
    height: n(v.height),
    width: n(v.width),
    scrollWidth: n(v.scrollWidth),
    empty: v.empty === true,
    followsFrame: v.followsFrame === true,
    unfinished: v.unfinished === true || undefined,
  };
}

/** The problems a report shows, each said so Claude can fix it. */
export function visualProblems(r: VisualReport): string[] {
  const list: string[] = [];
  const cap = (items: string[]) => items.slice(0, 5).map((s) => s.slice(0, 300));
  for (const e of cap(r.errors)) list.push(`Script error: ${e}`);
  for (const e of cap(r.consoleErrors)) list.push(`console.error: ${e}`);
  for (const b of cap(r.blocked)) list.push(`Not loaded: ${b}`);
  if (r.empty) list.push("Empty page: nothing visible was drawn (no text, image, canvas or svg with a size).");
  else if (r.height < 8) list.push(`Zero height: the page draws ${r.height}px tall.`);
  if (r.followsFrame) {
    list.push("The height follows the frame (vh units or height:100% on html/body): let the content set the height.");
  }
  if (r.scrollWidth > r.width + 4) {
    list.push(
      `Clipped: the page draws ${r.scrollWidth}px wide in a ${r.width}px frame. Use fluid widths (max-width:100%, flex-wrap, overflow-x:auto on wide tables).`,
    );
  }
  return list;
}

/**
 * The tool's answer: shown and fine, shown but unverified (no report in
 * time), or problems to fix first. A page with problems is an error: the
 * column keeps it folded until Claude sends one that works. A local file
 * left out is only a note: an image it breaks shows in the report anyway.
 */
export function visualResult(
  report: VisualReport | null,
  skipped: SkippedImage[],
): { text: string; isError: boolean } {
  const notes = skipped.map((s) => `Note: local image not inlined: ${s.path}: ${s.reason}`);
  if (!report) {
    return {
      text: ["Shown in the chat, not verified: Arkadia did not report on the page in time.", ...notes].join("\n"),
      isError: false,
    };
  }
  // Taller than fits even scaled down: a hint, never a problem.
  if (report.height > VISUAL_FIT_HEIGHT / VISUAL_FIT_FLOOR) {
    notes.push(
      `Note: the page is ${report.height}px tall; the chat shows about ${VISUAL_FIT_HEIGHT}px without scrolling. Next time prefer a more compact layout (side by side, smaller images, fewer lines).`,
    );
  }
  const problems = visualProblems(report);
  if (problems.length === 0) {
    return {
      text: [
        `${VISUAL_CHECKED_CLEAN}, ${report.height}px tall${report.unfinished ? ", still loading at the end of the check" : ""}). Do not describe it again in your reply.`,
        ...notes,
      ].join("\n"),
      isError: false,
    };
  }
  return {
    text: [
      "Arkadia rendered the page and found problems. The user sees it folded until you fix it: call show_visual again with the corrected page.",
      ...problems.map((p) => `- ${p}`),
      ...notes,
    ].join("\n"),
    isError: true,
  };
}
