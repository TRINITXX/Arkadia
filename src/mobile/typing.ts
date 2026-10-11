/**
 * Typing on a phone goes through a hidden text field, so the iPhone's
 * autocorrect and dictation work. They rewrite text already typed, which a
 * terminal cannot take back: each change of the field is replayed into the
 * prompt as backspaces down to the first difference, then the new text.
 */

const BACKSPACE = "\x7f";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function split(text: string): string[] {
  return Array.from(graphemes.segment(text), (s) => s.segment);
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
