import type { ChatItem } from "@/lib/chat/chatState";

/**
 * A round of questions Claude asks in plain text, answered from a sheet
 * above the input (`ChatQuestionSheet`). Two formats, as the notification
 * hook spots them (`arkadia-notify.ps1`): the grilling skill's
 * `❓ **Q1** - **title**: body` then `➡️ recommendation`, and the
 * « Question n sur N » of the user's instructions, its options `a) …` and
 * its « Je pencherais pour (x) : … ».
 */

export interface RoundOption {
  /** The letter as written: `a`, `B`. */
  key: string;
  label: string;
}

export interface RoundQuestion {
  /** `Q1`: how the answer names it. */
  id: string;
  title: string;
  body: string;
  options: RoundOption[];
  /** Claude's recommended answer, as written. */
  recommendation: string | null;
  /** The option it recommends, when it names one. */
  recommendedKey: string | null;
}

/** What the user gave a question: the recommendation, an option, words. */
export interface RoundAnswer {
  reco?: boolean;
  option?: string;
  text?: string;
}

const QUESTION_MARK = /^\s*❓️?\s*/;
const ARROW = /^\s*➡️?\s*/;
/** `a) Label`, `(a) Label`, `- **b)** Label`, `c. Label`. */
const OPTION =
  /^\s*(?:[-*•]\s+)?(?:\*\*)?\(?([a-hA-H])(?:\)|\.)(?:\*\*)?\s*[:\-–—]?\s*(.+)$/;
const SERIES = /^\s*\**\s*Question\s+(\d+)\s+sur\s+(\d+)\s*\**\s*\.?\s*$/i;
/** « Je pencherais pour (b) : … »: a letter alone, never a word's first
 *  (« pour celle qui… »). */
const LEANING =
  /je pencherais pour\s*\(?([a-hA-H])(?![\p{L}\d'’])\)?\s*[:,-]?\s*(.*)$/iu;

const unbold = (s: string) => s.replace(/\*\*/g, "").trim();

/** The key of the option `letter` names, as the option writes it (`b` for
 *  `B)`), or null. */
function optionKey(letter: string, options: RoundOption[]): string | null {
  const lower = letter.toLowerCase();
  return options.find((o) => o.key.toLowerCase() === lower)?.key ?? null;
}

/** The option a recommendation names first: `b) …`, `(b)`, `b :`. */
function namedKey(reco: string, options: RoundOption[]): string | null {
  const m = /^\s*(?:\*\*)?\(?([a-hA-H])(?:\)|\s*[:.,-]|\s*$)/.exec(reco);
  return m ? optionKey(m[1], options) : null;
}

function optionsOf(lines: string[]): RoundOption[] {
  const options: RoundOption[] = [];
  for (const line of lines) {
    const m = OPTION.exec(line);
    if (m) options.push({ key: m[1], label: unbold(m[2]) });
  }
  // A lone « a. » starts a sentence, not a choice.
  return options.length >= 2 ? options : [];
}

/** An option's letter inside a line: `a)`, `(b)`, `**c)**`. */
const INLINE_OPTION = /(^|[\s(:;,])(?:\*\*)?\(?([a-hA-H])\)(?:\*\*)?\s+/g;

/**
 * Options written on one line, `… ? a) Violet b) Vert c) Gris`: the letters
 * in order from a, two at least, each with its words. `rest`: what the line
 * says before them.
 */
function inlineOptions(
  line: string,
): { options: RoundOption[]; rest: string } | null {
  const marks: { key: string; at: number; end: number }[] = [];
  for (const m of line.matchAll(INLINE_OPTION)) {
    const last = marks[marks.length - 1];
    const want = last
      ? String.fromCharCode(last.key.toLowerCase().charCodeAt(0) + 1)
      : "a";
    // Another letter is part of a label: `b) le cas (c) seul`.
    if (m[2].toLowerCase() !== want) continue;
    marks.push({
      key: m[2],
      at: m.index + m[1].length,
      end: m.index + m[0].length,
    });
  }
  if (marks.length < 2) return null;
  // The sentence goes on around them: `a) Violet, b) Vert ou c) Gris ?`.
  const tidy = (label: string) =>
    label
      .replace(/[\s,;.?!]+$/, "")
      .replace(/\s+(?:ou|et)$/i, "")
      .replace(/[\s,;.?!]+$/, "");
  const options = marks.map((mark, i) => ({
    key: mark.key,
    label: tidy(unbold(line.slice(mark.end, marks[i + 1]?.at ?? line.length))),
  }));
  if (options.some((o) => !o.label)) return null;
  return { options, rest: line.slice(0, marks[0].at).trim() };
}

/** A question's options, one per line or all on one line, its lines without
 *  them, and the last line that held one (-1 for none). */
function optionsIn(lines: string[]): {
  options: RoundOption[];
  lines: string[];
  lastAt: number;
} {
  const options = optionsOf(lines);
  if (options.length > 0)
    return {
      options,
      lines: lines.filter((l) => !OPTION.test(l)),
      lastAt: lines.reduce((at, l, i) => (OPTION.test(l) ? i : at), -1),
    };
  for (let i = 0; i < lines.length; i++) {
    const inline = inlineOptions(lines[i]);
    if (inline)
      return {
        options: inline.options,
        lines: lines.map((l, j) => (j === i ? inline.rest : l)),
        lastAt: i,
      };
  }
  return { options: [], lines, lastAt: -1 };
}

/**
 * Where a recommendation shares the question's line (`… ? a) Petite
 * b) Grande ➡️ b) …`): its first ➡ after the « ? », else -1. A ➡ before
 * it, or in the body, is the question's own words (`clic ➡️ fiche`).
 */
function arrowAt(head: string): number {
  const asked = head.indexOf("?");
  return asked < 0 ? -1 : head.indexOf("➡", asked);
}

/** The question's line, its recommendation on a line of its own. */
function splitArrow(head: string): string[] {
  const at = arrowAt(head);
  if (at < 0) return [head];
  return [head.slice(0, at).trimEnd(), head.slice(at)];
}

const RULE = /^\s*-{3,}\s*$/;

/**
 * Each question's lines, `[start, end)`: from its ❓ up to the next ❓, a
 * `---`, or the blank line that closes its ➡️ paragraph (what follows is
 * Claude's own words again).
 */
function grillingBlocks(lines: string[]): [number, number][] {
  const blocks: [number, number][] = [];
  let start = -1;
  let advised = false;
  const close = (end: number) => {
    if (start >= 0) blocks.push([start, end]);
    start = -1;
  };
  lines.forEach((line, i) => {
    if (QUESTION_MARK.test(line)) {
      close(i);
      start = i;
      // The recommendation may share the question's line (`arrowAt`).
      advised = arrowAt(line) >= 0;
    } else if (start >= 0) {
      if (RULE.test(line) || (advised && !line.trim())) close(i);
      else if (ARROW.test(line)) advised = true;
    }
  });
  close(lines.length);
  return blocks;
}

/** `❓ **Q1** - **Titre** : corps…` blocks (`grillingBlocks`). */
function grillingRound(lines: string[]): RoundQuestion[] {
  const blocks = grillingBlocks(lines).map(([start, end]) => [
    ...splitArrow(lines[start]),
    ...lines.slice(start + 1, end),
  ]);
  return blocks.map((block, i) => {
    const head = block[0].replace(QUESTION_MARK, "");
    const number = /^\**\s*Q\s*(\d+)\s*\**\s*[-–—:.]?\s*/i.exec(head);
    let rest = number ? head.slice(number[0].length) : head;
    let title = "";
    const bold = /^\*\*(.+?)\*\*\s*:?\s*/.exec(rest);
    if (bold) {
      title = bold[1].replace(/:\s*$/, "").trim();
      rest = rest.slice(bold[0].length);
    }
    const body: string[] = [rest];
    let recommendation: string | null = null;
    for (const line of block.slice(1)) {
      if (ARROW.test(line)) {
        recommendation = unbold(line.replace(ARROW, ""));
        continue;
      }
      if (recommendation !== null) recommendation += `\n${line}`;
      else body.push(line);
    }
    recommendation = recommendation?.trim() || null;
    const { options, lines: kept } = optionsIn(body);
    const text = kept.join("\n").trim();
    return {
      id: `Q${number?.[1] ?? i + 1}`,
      title: title || unbold(text.split("\n")[0] ?? ""),
      body: title ? text : text.split("\n").slice(1).join("\n").trim(),
      options,
      recommendation,
      recommendedKey: recommendation ? namedKey(recommendation, options) : null,
    };
  });
}

/**
 * « Question n sur N. », context, the question, `a) b) c)`, the leaning: the
 * question, and its lines `[start, end)`, down to the leaning (else its
 * options). What follows is Claude's own words again.
 */
function seriesRead(
  lines: string[],
): { question: RoundQuestion; start: number; end: number } | null {
  const start = lines.findIndex((l) => SERIES.test(l));
  if (start < 0) return null;
  const n = SERIES.exec(lines[start])![1];
  const after = lines.slice(start + 1);
  // The options come before the leaning, whose « (a) » is none.
  const leanAt = after.findIndex((l) => LEANING.test(l));
  const scope = leanAt >= 0 ? after.slice(0, leanAt) : after;
  const found = optionsIn(scope);
  if (found.options.length === 0) return null;
  const last = leanAt >= 0 ? leanAt : found.lastAt;
  const { options, lines: kept } = optionsIn(scope.slice(0, last + 1));
  const lean = leanAt >= 0 ? LEANING.exec(after[leanAt]) : null;
  const recommendedKey = lean ? optionKey(lean[1], options) : null;
  const recommendation = lean ? `${lean[1]}) ${lean[2]}`.trim() : null;
  const prose = kept.filter((line) => line.trim()).map(unbold);
  // The question is its line ending with « ? », the rest is context.
  let qi = -1;
  prose.forEach((l, i) => {
    if (l.trimEnd().endsWith("?")) qi = i;
  });
  const title = qi >= 0 ? prose[qi] : (prose[0] ?? "");
  return {
    question: {
      id: `Q${n}`,
      title,
      body: prose.filter((_, i) => i !== (qi >= 0 ? qi : 0)).join("\n"),
      options,
      recommendation,
      recommendedKey,
    },
    start,
    end: start + 1 + last + 1,
  };
}

function seriesQuestion(lines: string[]): RoundQuestion[] {
  const read = seriesRead(lines);
  return read ? [read.question] : [];
}

function seriesBlock(lines: string[]): [number, number][] {
  const read = seriesRead(lines);
  return read ? [[read.start, read.end]] : [];
}

const linesOf = (text: string) => text.replace(/\r\n/g, "\n").split("\n");
const isGrilling = (lines: string[]) =>
  lines.some((l) => QUESTION_MARK.test(l));

/** The questions of a reply, or none when it asks no round. */
export function parseQuestionRound(text: string): RoundQuestion[] {
  const lines = linesOf(text);
  if (isGrilling(lines)) return grillingRound(lines);
  return seriesQuestion(lines);
}

/**
 * The reply without its questions, while the sheet shows them: Claude's
 * other words stay where they were. A `---` beside a question goes with it.
 */
export function withoutQuestions(text: string): string {
  const lines = linesOf(text);
  const blocks = isGrilling(lines) ? grillingBlocks(lines) : seriesBlock(lines);
  const drop = new Set<number>();
  for (const [start, end] of blocks) {
    for (let i = start; i < end; i++) drop.add(i);
  }
  const near = (i: number, step: 1 | -1) => {
    let j = i + step;
    while (j >= 0 && j < lines.length && !lines[j].trim()) j += step;
    return drop.has(j);
  };
  lines.forEach((line, i) => {
    if (RULE.test(line) && (near(i, -1) || near(i, 1))) drop.add(i);
  });
  return lines
    .filter((_, i) => !drop.has(i))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The round Claude's last reply asks, if any: its text after the user's last
 * message, finished. `id` names the reply, so a sheet closed stays closed.
 */
export function lastReplyRound(
  items: readonly ChatItem[],
): { id: string; questions: RoundQuestion[] } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "user" || item.kind === "command") return null;
    if (item.kind !== "text") continue;
    if (item.streaming || item.error) return null;
    const questions = parseQuestionRound(item.text);
    return questions.length > 0 ? { id: item.id, questions } : null;
  }
  return null;
}

/**
 * Why Claude recommends `option`, its name aside: what the option's line
 * shows beside it (« a) 9 h : tu le lis tôt » → « tu le lis tôt »).
 */
export function recoReason(
  recommendation: string,
  option: RoundOption,
): string {
  const key = option.key.replace(/[^a-z]/gi, "");
  let rest = recommendation
    .trim()
    .replace(new RegExp(String.raw`^\(?${key}\)?(?=[\s:.,)-]|$)\s*`, "i"), "")
    // `b : Grande, …` as `b) Grande, …`.
    .replace(/^[\s:,.\-–—]+/, "");
  if (rest.toLowerCase().startsWith(option.label.toLowerCase()))
    rest = rest.slice(option.label.length);
  return rest.replace(/^[\s:,.\-–—]+/, "").trim();
}

/** One line per answered question: `Q1 : b) Label, mes mots`. */
export function roundReply(
  questions: readonly RoundQuestion[],
  answers: Readonly<Record<string, RoundAnswer>>,
): string {
  return questions
    .flatMap((q) => {
      const a = answers[q.id];
      if (!a) return [];
      const option = q.options.find((o) => o.key === a.option);
      const parts = [
        a.reco ? "OK pour ta reco" : null,
        option ? `${option.key}) ${option.label}` : null,
        a.text?.trim() || null,
      ].filter(Boolean);
      return parts.length > 0 ? [`${q.id} : ${parts.join(", ")}`] : [];
    })
    .join("\n");
}
