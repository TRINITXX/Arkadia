/**
 * Claude's markdown reduced to one plain line, for the sidebar's progress
 * line under a tab (`chatProgress`): its first line of prose, without the
 * marks of bold, code, headings, lists, quotes and links (their text stays).
 */

const FENCE = /^\s*(?:```|~~~)/;
/** `---`, `***`, a table's `|---|---|`, a setext `===`: no words. */
const NO_WORDS = /^[\s|:*_=~-]+$/;

/** One line of markdown as plain words. */
function plain(line: string): string {
  return line
    .replace(/^\s*(?:>\s*)+/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** A closing colon or period goes (« … : » announcing a list); « … » stays. */
const unclosed = (words: string) =>
  words.replace(/\s*:$/, "").replace(/(?<!\.)\.$/, "");

/** The first line of prose of `text`, plain; "" when it has none. */
export function firstLine(text: string): string {
  let fenced = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line.trim() || NO_WORDS.test(line)) continue;
    const words = plain(line);
    if (words) return unclosed(words);
  }
  return "";
}

/** A sentence's end, more words after it. */
const SENTENCE_END = /[.!?…](?=\s+\S)/;

/** The first sentence of `text`'s first line of prose, plain. */
export function firstSentence(text: string): string {
  const line = firstLine(text);
  const end = SENTENCE_END.exec(line);
  return end ? unclosed(line.slice(0, end.index + 1)) : line;
}
