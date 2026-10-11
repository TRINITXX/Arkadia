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
