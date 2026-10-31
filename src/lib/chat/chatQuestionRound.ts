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
const LEANING = /je pencherais pour\s*\(?([a-hA-H])\)?\s*[:,-]?\s*(.*)$/i;

const unbold = (s: string) => s.replace(/\*\*/g, "").trim();

/** The option a recommendation names first: `b) …`, `(b)`, `b :`. */
function namedKey(reco: string, options: RoundOption[]): string | null {
  const m = /^\s*(?:\*\*)?\(?([a-hA-H])(?:\)|\s*[:.,-]|\s*$)/.exec(reco);
  if (!m) return null;
  return options.find((o) => o.key.toLowerCase() === m[1].toLowerCase())
    ? m[1]
    : null;
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
      advised = false;
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
  const blocks = grillingBlocks(lines).map(([start, end]) =>
    lines.slice(start, end),
  );
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
    const options = optionsOf(body);
    const text = body
      .filter((l) => !(options.length > 0 && OPTION.test(l)))
      .join("\n")
      .trim();
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

/** « Question n sur N. », context, the question, `a) b) c)`, the leaning. */
function seriesQuestion(lines: string[]): RoundQuestion[] {
  const start = lines.findIndex((l) => SERIES.test(l));
  if (start < 0) return [];
  const n = SERIES.exec(lines[start])![1];
  const after = lines.slice(start + 1);
  const options = optionsOf(after);
  if (options.length === 0) return [];
  let recommendation: string | null = null;
  let recommendedKey: string | null = null;
  const prose: string[] = [];
  for (const line of after) {
    const lean = LEANING.exec(line);
    if (lean) {
      recommendedKey = lean[1];
      recommendation = `${lean[1]}) ${lean[2]}`.trim();
      continue;
    }
    if (!OPTION.test(line) && line.trim()) prose.push(unbold(line));
  }
  // The question is its line ending with « ? », the rest is context.
  let qi = -1;
  prose.forEach((l, i) => {
    if (l.trimEnd().endsWith("?")) qi = i;
  });
  const title = qi >= 0 ? prose[qi] : (prose[0] ?? "");
  return [
    {
      id: `Q${n}`,
      title,
      body: prose.filter((_, i) => i !== (qi >= 0 ? qi : 0)).join("\n"),
      options,
      recommendation,
      recommendedKey,
    },
  ];
}

/** « Question n sur N. » down to the leaning (else the last option). */
function seriesBlock(lines: string[]): [number, number][] {
  if (seriesQuestion(lines).length === 0) return [];
  const start = lines.findIndex((l) => SERIES.test(l));
  let end = start + 1;
  for (let i = start + 1; i < lines.length; i++) {
    if (LEANING.test(lines[i])) {
      end = i + 1;
      break;
    }
    if (OPTION.test(lines[i])) end = i + 1;
  }
  return [[start, end]];
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
