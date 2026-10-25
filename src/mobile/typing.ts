/**
 * Typing on a phone goes through a hidden text field, so the iPhone's
 * autocorrect and dictation work. They rewrite text already typed, which a
 * terminal cannot take back: each change of the field is replayed into the
 * prompt as backspaces down to the first difference, then the new text.
 */

const BACKSPACE = "\x7f";

const graphemes =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const ZWJ = 0x200d;
/** Code points that belong to the character before them: combining marks,
 *  variation selectors, the keycap, skin tones, tag characters. */
const EXTENDS: [number, number][] = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0x1f3fb, 0x1f3ff],
  [0xe0020, 0xe007f],
];

const extendsPrevious = (cp: number) =>
  cp === ZWJ || EXTENDS.some(([lo, hi]) => cp >= lo && cp <= hi);
const isRegional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;

/**
 * Characters as iOS erases them, for an engine without Intl.Segmenter (the
 * iPhone app's Hermes may lack it): code points, with what extends or joins
 * an emoji kept on it, and flags as pairs of letters.
 */
function splitFallback(text: string): string[] {
  const out: string[] = [];
  let joined = false;
  // A flag's first letter, still waiting for its second.
  let lonelyRegional = false;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    const pairs: boolean = lonelyRegional && isRegional(cp);
    if (out.length > 0 && (joined || extendsPrevious(cp) || pairs))
      out[out.length - 1] += char;
    else out.push(char);
    lonelyRegional = isRegional(cp) && !pairs;
    joined = cp === ZWJ;
  }
  return out;
}

function split(text: string): string[] {
  return graphemes
    ? Array.from(graphemes.segment(text), (s) => s.segment)
    : splitFallback(text);
}

/**
 * Clipboard text as a terminal paste: line breaks become the terminal's Enter,
 * wrapped in bracketed-paste markers when the app asked for them (Claude
 * does), so a pasted line break does not submit the prompt.
 */
export function pasteData(text: string, bracketed: boolean): string {
  const normalized = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
  return bracketed ? `\x1b[200~${normalized}\x1b[201~` : normalized;
}

/** The keystrokes that turn `sent` (already in the prompt) into `now`. */
export function typingDelta(sent: string, now: string): string {
  const before = split(sent);
  const after = split(now);
  let same = 0;
  while (
    same < before.length &&
    same < after.length &&
    before[same] === after[same]
  )
    same += 1;
  return BACKSPACE.repeat(before.length - same) + after.slice(same).join("");
}
