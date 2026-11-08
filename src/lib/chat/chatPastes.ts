/**
 * A long text pasted in the chat's input stands as a tag in it,
 * « [Texte collé #1 · 42 mots] », as Claude Code does (the user's pick A of
 * 01/11/2026): the input stays short, the tag's hover shows and edits the
 * text, a second paste of the same text puts it back in place, and the
 * message sends the text itself. In the user's frame, a text sent so shows
 * as a tag again (`rememberPastes`).
 */

/** A paste of this many words or more becomes a tag. */
export const PASTE_MIN_WORDS = 10;

export interface PastedText {
  id: number;
  text: string;
}

export const wordCount = (text: string) =>
  text.split(/\s+/).filter(Boolean).length;

const plural = (n: number) => `${n} mot${n > 1 ? "s" : ""}`;

/** The tag a paste stands as in the input. */
export const pasteTag = (paste: PastedText) =>
  `[Texte collé #${paste.id} · ${plural(wordCount(paste.text))}]`;

const TAG_RE = /\[Texte collé #(\d+) · \d+ mots?\]/g;

/** Where the tags of known pastes sit in the text, in order. */
export function pasteSpans(
  text: string,
  pastes: readonly PastedText[],
): { start: number; end: number; paste: PastedText }[] {
  const out: { start: number; end: number; paste: PastedText }[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const paste = pastes.find((p) => p.id === Number(m[1]));
    if (paste && m[0] === pasteTag(paste))
      out.push({ start: m.index, end: m.index + m[0].length, paste });
  }
  return out;
}

/** The text with each tag back as the text it stands for (what is sent). */
export function expandPastes(
  text: string,
  pastes: readonly PastedText[] = [],
): string {
  let out = "";
  let at = 0;
  for (const s of pasteSpans(text, pastes)) {
    out += text.slice(at, s.start) + s.paste.text;
    at = s.end;
  }
  return out + text.slice(at);
}

/**
 * A paste in the input, `start`..`end` selected: a long one becomes a tag
 * at the caret; the same text pasted again while its tag is there puts the
 * text in the tag's place. Null: a short one, pasted as is.
 */
export function pasteInto(
  text: string,
  start: number,
  end: number,
  pasted: string,
  pastes: readonly PastedText[],
): { text: string; pastes: PastedText[]; caret: number } | null {
  const again = pasteSpans(text, pastes).find((s) => s.paste.text === pasted);
  if (again) {
    return {
      text: text.slice(0, again.start) + pasted + text.slice(again.end),
      pastes: pastes.filter((p) => p !== again.paste),
      caret: again.start + pasted.length,
    };
  }
  if (wordCount(pasted) < PASTE_MIN_WORDS) return null;
  const paste = {
    id: pastes.reduce((n, p) => Math.max(n, p.id), 0) + 1,
    text: pasted,
  };
  const tag = pasteTag(paste);
  return {
    text: text.slice(0, start) + tag + text.slice(end),
    pastes: [...pastes, paste],
    caret: start + tag.length,
  };
}

/** A paste edited from its tag's hover: its text and its tag follow. */
export function editPaste(
  text: string,
  pastes: readonly PastedText[],
  id: number,
  next: string,
): { text: string; pastes: PastedText[] } {
  const span = pasteSpans(text, pastes).find((s) => s.paste.id === id);
  if (!span) return { text, pastes: [...pastes] };
  const paste = { id, text: next };
  return {
    text: text.slice(0, span.start) + pasteTag(paste) + text.slice(span.end),
    pastes: pastes.map((p) => (p.id === id ? paste : p)),
  };
}

/** A tag put back as its text (« Mettre le texte »). */
export function unfoldPaste(
  text: string,
  pastes: readonly PastedText[],
  id: number,
): { text: string; pastes: PastedText[] } {
  const span = pasteSpans(text, pastes).find((s) => s.paste.id === id);
  if (!span) return { text, pastes: [...pastes] };
  return {
    text: text.slice(0, span.start) + span.paste.text + text.slice(span.end),
    pastes: pastes.filter((p) => p.id !== id),
  };
}

/**
 * The texts sent from tags, for the user's frames to show them as tags
 * again. Kept by the page; the message carries them too (`send`'s `pastes`,
 * the item's `pastes`), for the phone and a reloaded page.
 */
const sentPastes = new Set<string>();

export function rememberPastes(texts: readonly string[]): void {
  // Trimmed as the message is sent; never a few words that would turn up
  // in any later message.
  for (const t of texts)
    if (wordCount(t) >= PASTE_MIN_WORDS) sentPastes.add(t.trim());
}

/**
 * The tag a caret sits by (`edge`: just after it for Backspace, just
 * before it for Delete) or strictly inside: a tag is one block, never
 * edited letter by letter (a broken tag would send its words, not its text).
 */
export function tagAt(
  text: string,
  pastes: readonly PastedText[],
  pos: number,
  edge: "after" | "before" | "inside",
): { start: number; end: number; paste: PastedText } | null {
  return (
    pasteSpans(text, pastes).find((s) =>
      edge === "after"
        ? s.end === pos
        : edge === "before"
          ? s.start === pos
          : s.start < pos && pos < s.end,
    ) ?? null
  );
}

/** A tag removed whole, its text with it. */
export function dropTag(
  text: string,
  pastes: readonly PastedText[],
  span: { start: number; end: number; paste: PastedText },
): { text: string; pastes: PastedText[] } {
  return {
    text: text.slice(0, span.start) + text.slice(span.end),
    pastes: pastes.filter((p) => p !== span.paste),
  };
}

/**
 * The pastes whose tag was edited into something else (a selection typed
 * over): sending would lose their text, so the input says so first.
 */
export function brokenPastes(
  text: string,
  pastes: readonly PastedText[],
): PastedText[] {
  const whole = new Set(pasteSpans(text, pastes).map((s) => s.paste.id));
  return pastes.filter(
    (p) => !whole.has(p.id) && text.includes(`[Texte collé #${p.id} ·`),
  );
}

/** The sent pastes a message holds, the longest first. */
export function pastesIn(text: string): string[] {
  return [...sentPastes]
    .filter((t) => text.includes(t))
    .sort((a, b) => b.length - a.length);
}

/**
 * The pastes a user's frame shows as tags, the longest first: those its
 * message carries (all the phone knows, and a reloaded page), and those this
 * page sent (`pastesIn`), on the desktop and the iPhone alike (02/11/2026).
 */
export function framePastes(
  text: string,
  carried: readonly string[] = [],
): string[] {
  const all = new Set([
    ...carried.filter((t) => text.includes(t)),
    ...pastesIn(text),
  ]);
  return [...all].sort((a, b) => b.length - a.length);
}

/** A sent paste's tag in the user's frame: « Texte collé · 12 mots ». */
export const sentPasteLabel = (text: string) =>
  `Texte collé · ${plural(wordCount(text))}`;

/** A sent paste's tag, as a link the frame's markdown draws as a chip. */
const PASTE_HREF = "#arkadia-paste-";

/** The frame's text with each paste as its tag's link (`pasteOfHref`). */
export function withPasteTags(text: string, pastes: readonly string[]): string {
  return pastes.reduce(
    (t, paste, i) =>
      t.split(paste).join(`[${sentPasteLabel(paste)}](${PASTE_HREF}${i})`),
    text,
  );
}

/** The paste a tag's link stands for; null: another link. */
export function pasteOfHref(
  href: string,
  pastes: readonly string[],
): string | null {
  if (!href.startsWith(PASTE_HREF)) return null;
  return pastes[Number(href.slice(PASTE_HREF.length))] ?? null;
}

/**
 * A paste as Claude Code keeps it in the session: wrapped in tags named by
 * 4 hex digits, opening and closing alike, each on its own line (its
 * terminal since 10/2026, the chat's `inline_pastes` since 08/11/2026).
 */
const WRAPPED =
  /\n{0,2}<pasted_content id="([0-9a-f]{4})">\n(?:([\s\S]*?)\n)?<\/pasted_content id="\1">\n{0,2}/g;

/** Claude Code's escape of a tag's name inside the text (« <\pasted_content »). */
const ESCAPED_TAG = /<\\(?=\/?pasted_content)/g;

/**
 * A user message read back from the session: its pastes out of their tags,
 * each a paragraph (a paste sent mid-line comes back on its own), the long
 * ones apart for the frame to show as tags.
 */
export function unwrapPastes(text: string): { text: string; pastes: string[] } {
  const parts: string[] = [];
  const pastes: string[] = [];
  const unescape = (s: string) => s.replace(ESCAPED_TAG, "<");
  let at = 0;
  for (const m of text.matchAll(WRAPPED)) {
    if (m.index > at) parts.push(unescape(text.slice(at, m.index)));
    // Trimmed, as the chat sends it: the frame finds it in the text whole.
    const body = unescape(m[2] ?? "").trim();
    parts.push(body);
    if (wordCount(body) >= PASTE_MIN_WORDS) pastes.push(body);
    at = m.index + m[0].length;
  }
  if (at === 0) return { text, pastes };
  if (at < text.length) parts.push(unescape(text.slice(at)));
  return { text: parts.join("\n\n").trim(), pastes };
}
