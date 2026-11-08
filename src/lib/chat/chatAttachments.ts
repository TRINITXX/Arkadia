import type { ChatDraft, DraftFile, DraftImage } from "@/lib/chat/chatDrafts";
import { imagePathKey } from "@/lib/imagePaths";
import { foldPastes, renumberPastes } from "@/lib/chat/chatPastes";

/**
 * Files attached to a chat message by their path: cards above the input
 * (picker, drag & drop, a pasted path), sent as the text's last line, each
 * path quoted as the terminal types it (Claude Code reads files from paths).
 * The user's frame shows them as cards again, never as text.
 */

/** Characters Windows forbids in a name, `:` past the drive letter included. */
const PATH_BODY = String.raw`[^"<>|?*:\r\n]*`;
/** An absolute Windows path, whole. */
const ABS_PATH_RE = new RegExp(String.raw`^[A-Za-z]:[\\/]${PATH_BODY}$`);
/** An absolute Windows path in double quotes, anywhere in a text. */
const QUOTED_PATH_RE = new RegExp(
  String.raw`"([A-Za-z]:[\\/]${PATH_BODY})"`,
  "g",
);
/** A line made of quoted paths only. */
const QUOTED_LINE_RE = new RegExp(
  String.raw`^(?:"[A-Za-z]:[\\/]${PATH_BODY}"\s*)+$`,
);

/** A bare path alone on its line, as an attachment: it ends with a file's
 *  extension, so prose after a path (« …130956.png le menu déborde ») keeps
 *  the line as text. */
const BARE_LINE_RE = new RegExp(
  String.raw`^[A-Za-z]:[\\/]${PATH_BODY}\.[A-Za-z0-9]{1,8}$`,
);
/** A code fence's opening or closing line. */
const FENCE_RE = /^\s*(?:```|~~~)/;

/** A pasted text of more paths than this is no attachment. */
const MAX_PASTED_PATHS = 50;

let nextId = 0;

/** The name a card shows: the path's last part (a folder's, too). */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** `paths` deduped (case and slash style ignored), first spelling kept. */
function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((p) => {
    const key = imagePathKey(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What the message says to Claude: the text, then the attached paths. */
export function withAttachedPaths(text: string, paths: string[]): string {
  if (paths.length === 0) return text;
  const line = paths.map((p) => `"${p}"`).join(" ");
  return text ? `${text}\n\n${line}` : line;
}

function quotedIn(line: string): string[] {
  return [...line.matchAll(QUOTED_PATH_RE)].map((m) => m[1]);
}

/** The paths an attachment line is made of (quoted paths alone, or one
 *  bare file path alone), or null for any other line. */
function attachedIn(line: string): string[] | null {
  const bare = line.trim();
  if (bare && QUOTED_LINE_RE.test(bare)) return quotedIn(bare);
  return BARE_LINE_RE.test(bare) ? [bare] : null;
}

/** `text`'s lines, each told whether it sits in a code block (its fences
 *  included): a path there is code, never an attachment. */
function linesOf(text: string): { line: string; code: boolean }[] {
  let fenced = false;
  return text.split(/\r?\n/).map((line) => {
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      return { line, code: true };
    }
    return { line, code: fenced };
  });
}

/** `line` with `edit` applied outside its `code spans`. */
function outsideCode(line: string, edit: (part: string) => string): string {
  return line
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : edit(part)))
    .join("");
}

/** Lines joined back, the gaps left by removed ones closed. */
function tidy(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A message's text without its attachment lines, and those paths. What the
 * input gets back: a path quoted inside a sentence stays where it was typed.
 */
export function splitAttachedLines(text: string): {
  text: string;
  paths: string[];
} {
  const paths: string[] = [];
  const kept: string[] = [];
  for (const { line, code } of linesOf(text)) {
    const attached = code ? null : attachedIn(line);
    if (attached) paths.push(...attached);
    else kept.push(line);
  }
  return { text: tidy(kept), paths: dedupe(paths) };
}

/**
 * A user message as its frame shows it: every file it attaches or quotes
 * as a card, in reading order. A path quoted inside a sentence leaves its
 * file name there, so the sentence still reads.
 */
export function messageCards(text: string): { text: string; paths: string[] } {
  const paths: string[] = [];
  const kept: string[] = [];
  for (const { line, code } of linesOf(text)) {
    if (code) {
      kept.push(line);
      continue;
    }
    const attached = attachedIn(line);
    if (attached) {
      paths.push(...attached);
      continue;
    }
    kept.push(
      outsideCode(line, (part) =>
        part.replace(QUOTED_PATH_RE, (_, path: string) => {
          paths.push(path);
          return `\`${fileName(path)}\``;
        }),
      ),
    );
  }
  return { text: tidy(kept), paths: dedupe(paths) };
}

/**
 * The paths a pasted text is made of, or null when it holds anything else:
 * quoted paths (Explorer's « Copier en tant que chemin d'accès »), or one
 * bare path per line. Whether they exist is the caller's to check.
 */
export function pastedPaths(text: string): string[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const paths: string[] = [];
  for (const line of lines) {
    if (QUOTED_LINE_RE.test(line)) paths.push(...quotedIn(line));
    else if (ABS_PATH_RE.test(line)) paths.push(line);
    else return null;
  }
  return paths.length <= MAX_PASTED_PATHS ? dedupe(paths) : null;
}

/** A path as a card of the input. */
export function draftFile(path: string): DraftFile {
  nextId += 1;
  return { id: `file:${nextId}`, path };
}

/** The draft with `paths` attached after its files, none twice. */
export function attachPaths(draft: ChatDraft, paths: string[]): ChatDraft {
  const files = draft.files ?? [];
  const known = new Set(files.map((f) => imagePathKey(f.path)));
  const added = dedupe(paths).filter((p) => !known.has(imagePathKey(p)));
  if (added.length === 0) return draft;
  return { ...draft, files: [...files, ...added.map(draftFile)] };
}

/** A pasted image kept as a data URL, back as an image of the input. */
function draftImage(url: string, n: number, label: number): DraftImage | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!m) return null;
  nextId += 1;
  // Numbered as sent: its « [Image #n] » in the text names it again.
  return {
    id: `back:${nextId}:${n}`,
    url,
    mediaType: m[1],
    data: m[2],
    n: label,
  };
}

const IMAGE_TAG = /\[Image #(\d+)\]/g;

/** The image numbers a text's tags give, in order, once each. */
const imageTags = (text: string) => [
  ...new Set([...text.matchAll(IMAGE_TAG)].map((m) => Number(m[1]))),
];

/**
 * A sent message as a draft again: its text, its attachment lines as cards,
 * the pasted images the chat still keeps (`ChatItem.pasted`), and its
 * pasted texts as tags (`ChatItem.pastes`, `foldPastes`).
 */
export function messageDraft(
  text: string,
  pasted: string[] = [],
  pastes: readonly string[] = [],
): ChatDraft {
  const split = splitAttachedLines(text);
  // The numbers its text gives them, in order (« [Image #2] [Image #3] »
  // once #1 was removed); else 1, 2, …
  const named = imageTags(split.text);
  const folded = foldPastes(split.text, pastes);
  return {
    text: folded.text,
    images: pasted
      .map((url, i) => draftImage(url, i, named[i] ?? i + 1))
      .filter((img): img is DraftImage => img !== null),
    files: split.paths.map(draftFile),
    ...(folded.pastes.length > 0 ? { pastes: folded.pastes } : {}),
  };
}

/** `back` put into the input before what it holds now, one line apart. */
export function mergeDrafts(back: ChatDraft, now: ChatDraft): ChatDraft {
  // The input's images numbered after those coming back, their tags with
  // them: never two « [Image #1] ».
  const after = Math.max(
    0,
    ...back.images.map((img) => img.n ?? 0),
    ...imageTags(back.text),
  );
  const nowText = after
    ? now.text.replace(
        IMAGE_TAG,
        (_, d: string) => `[Image #${Number(d) + after}]`,
      )
    : now.text;
  // The pasted texts coming back numbered after the input's: its own keep
  // their numbers, a tag the user broke there still said at sending.
  const nowPastes = now.pastes ?? [];
  const backPastes = renumberPastes(
    back.text,
    back.pastes ?? [],
    Math.max(0, ...nowPastes.map((p) => p.id)),
  );
  const pastes = [...backPastes.pastes, ...nowPastes];
  const backText = backPastes.text;
  const text =
    backText && nowText ? `${backText}\n${nowText}` : backText || nowText;
  return attachPaths(
    {
      text,
      images: [
        ...back.images,
        ...now.images.map((img) =>
          img.n && after ? { ...img, n: img.n + after } : img,
        ),
      ],
      files: back.files,
      // Both drafts' pasted texts: their tags stay in the text.
      ...(pastes.length > 0 ? { pastes } : {}),
    },
    (now.files ?? []).map((f) => f.path),
  );
}
