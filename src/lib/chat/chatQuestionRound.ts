import type { ChatItem } from "@/lib/chat/chatState";

/**
 * A round of questions Claude asks in plain text, answered from a sheet
 * above the input (`ChatQuestionSheet`). Three formats, as the notification
 * hook spots them (`arkadia-notify.ps1`): the grilling skill's
 * `❓ **Q1** - **title**: body` then `➡️ recommendation`, its look-alike
 * (`**Q1.** question ?` then `Reco : oui.`), and the « Question n sur N »
 * of the user's instructions, its options `a) …` and its « Je pencherais
 * pour (x) : … ». Since 11/11/2026 his instructions lead every question
 * with a ❓: older replies, and a session that forgets it, go without.
 */

export interface RoundOption {
  /** The letter as written: `a`, `B`. */
  key: string;
  label: string;
}

export interface RoundQuestion {
  /** `Q1`: Claude's number, else its place in its reply. */
  id: string;
  /** Claude wrote its number (`Q1`, « Question 1 sur 3 »): the same number
   *  in a later reply asks it again. */
  numbered: boolean;
  /** Where the sheet keeps its answer: unique to the reply that asked it,
   *  so a question asked again, or a new round, starts unanswered. */
  key: string;
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
/** A recommendation's start: `➡️`, `Reco :`, `**Reco :**`. */
const ARROW = /^\s*(?:➡️?|\**\s?(?:Reco|Recommandation)\s?\**\s*:\s?\**)\s*/i;
/** A bare « Reco : »: Claude's own word for his advice on a question. */
const RECO = /^\s*\**\s?Reco\s?\**\s*:/i;
/** `**Q1.** Question ?`, `Q2 : …`, `### Q3 - …`: the grilling's numbered
 *  question without its ❓ (missed on 11/11/2026). A dot, a colon, a dash
 *  or the bold's end after the number, then words: « Q1 2026 » and
 *  « Q3-2026 : » are prose. Read through `numberedHead` only. */
const NUMBERED =
  /^(?:#{1,6} )?(?:\*\*Q\d+ ?[.:)–—-]? ?\*\*|Q\d+ ?[.:)–—-]) ?[.:–—-]? ?[^\d\s]/i;
/** `NUMBERED` on a line whose blanks are single spaces (`seriesHeader`). */
const numberedHead = (line: string) =>
  NUMBERED.test(line.replace(/\s+/g, " ").trim());
/** `a) Label`, `(a) Label`, `- **b)** Label`, `c. Label`. */
const OPTION =
  /^\s*(?:[-*•]\s+)?(?:\*\*)?\(?([a-hA-H])(?:\)|\.)(?:\*\*)?\s*[:\-–—]?\s*(.+)$/;
/** « Question 1 sur 2. », bold or a heading or neither, a dot or a colon in
 *  or out of the bold (`**Question 1 sur 2.**`, missed on 02/11/2026).
 *  Its context may follow on its line after a dot, a colon or the bold's
 *  end (`**Question 1 sur 3.** Le filtre…`, missed on 09/11/2026): group 3.
 *  A ❓ may lead it, as every question since 11/11/2026. Read through
 *  `seriesHeader` only. */
const SERIES =
  /^\s*(?:❓️?\s*)?(?:#{1,6}\s*)?\**\s*Question\s+(\d+)\s+sur\s+(\d+)(?:\s*[.:]?\s*\**\s*[.:]?\s*|\s*(?:[.:]\s*\**|\*\*\s*[.:]?)\s+(\S.*))$/i;
/** `SERIES` on a line whose blanks are single spaces: its `\s*` side by side
 *  would try every split of a long run of blanks (seconds for 400). */
const seriesHeader = (line: string) =>
  SERIES.exec(line.replace(/\s+/g, " ").trim());
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

/** « Je pencherais pour oui : … »: the leaning of a yes-or-no question. */
const YES_NO_LEANING =
  /je pencherais pour\s*\(?(oui|non)(?![\p{L}-])\)?\s*[:,-]?\s*(.*)$/iu;
const isLeaning = (line: string) =>
  LEANING.test(line) || YES_NO_LEANING.test(line);

/** A leaning's recommendation, and the option it names: by its letter, or
 *  the one whose label starts with its « oui » / « non ». */
function leaningOf(
  line: string,
  options: RoundOption[],
): { recommendation: string; key: string | null } | null {
  const said = YES_NO_LEANING.exec(line);
  if (said) {
    const why = said[2].replace(/^[\s.,:;-]+/, "").trim();
    const word = new RegExp(String.raw`^${said[1]}(?![\p{L}])`, "iu");
    return {
      recommendation: why ? `${said[1]} : ${why}` : said[1],
      key: options.find((o) => word.test(o.label))?.key ?? null,
    };
  }
  const letter = LEANING.exec(line);
  if (!letter) return null;
  return {
    recommendation: `${letter[1]}) ${letter[2]}`.trim(),
    key: optionKey(letter[1], options),
  };
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

/** The choices of a closed question Claude wrote none for: never a question
 *  without two at least (the user's ask of 12/11/2026). */
const YES_NO: RoundOption[] = [
  { key: "a", label: "Oui" },
  { key: "b", label: "Non" },
];

/** A word that opens a question anywhere in it: « Quel nom ? », « On le
 *  range où ? », « On fait quoi ? ». « Tel quel » is no question word. */
const OPEN_WORD =
  /(?<![\p{L}])(?<!tel(?:le)?s?\s+)(?:quel(?:le)?s?|lequel|laquelle|lesquel(?:le)?s|auquel|duquel|auxquel(?:le)?s|desquel(?:le)?s|comment|combien|pourquoi|où|quoi)(?![\p{L}])/iu;
/** A word that opens a question at its start or ends it: « Qui s'en
 *  charge ? », « On publie quand ? », never « Je supprime le fichier qui
 *  bloque ? ». */
const OPEN_EDGE =
  /^(?:(?:et|alors|du coup|donc)[\s,]+)?(?:(?:à|de|pour|par|avec|chez|sur|depuis)\s+)?(?:(?:qui|que|quand)(?![\p{L}])|qu['’])|(?<![\p{L}])(?:qui|quand)\s*\?$/iu;
/** An alternative: « Le violet ou le vert ? », never « Je poste ou pas ? ». */
const EITHER = /(?<![\p{L}])ou(?![\p{L}])(?!\s+(?:pas|non)(?![\p{L}]))/iu;

/** Whether `s` ends with a « ? », a quote's or an emphasis' end aside. */
const endsAsking = (s: string) => s.replace(/[\s»”")*_]+$/, "").endsWith("?");

/** Whether each line sits in a ``` block, its fences included. */
function inCode(lines: string[]): boolean[] {
  let open = false;
  return lines.map((line) => {
    const fence = /^\s*(?:```|~~~)/.test(line);
    const was = open;
    if (fence) open = !open;
    return fence || was;
  });
}

/** Whether `text` asks only yes-or-no questions, one at least. */
function closedQuestion(text: string): boolean {
  const asks = unbold(text)
    .split(/\n+|(?<=[.!?…])\s+/)
    .map((s) => s.replace(/^[\s>*_•-]+/, "").replace(/[\s»”")*_]+$/, ""))
    .filter(endsAsking);
  return (
    asks.length > 0 &&
    asks.every(
      (s) => !OPEN_WORD.test(s) && !OPEN_EDGE.test(s) && !EITHER.test(s),
    )
  );
}

/** The word Claude asks the user to send back: « réponds « fait » ». */
const REPLY_WORD =
  /(?<![\p{L}])(?:réponds|répondez|dis|dites|écris|écrivez|tape|tapez)(?:-moi)?\s+[«"“]\s*([^»"”\n]{1,30}?)\s*[»"”]/iu;

/**
 * The one choice of an action Claude asks for (« Connecte-toi à KDP, puis
 * réponds « fait » »), the user's words below it (his ask of 12/11/2026):
 * the word it asks back, else « Fait ». Never with a « ? », its
 * recommendation's too: that is a question. Bare, never with a
 * recommendation nor a question word either (« Dis-moi quel nom… »).
 */
function actionChoice(
  text: string,
  recommendation: string | null,
): RoundOption[] | null {
  if (`${text}\n${recommendation ?? ""}`.includes("?")) return null;
  const word = REPLY_WORD.exec(unbold(text))?.[1];
  if (word) return [{ key: "a", label: word[0].toUpperCase() + word.slice(1) }];
  if (recommendation !== null || OPEN_WORD.test(text)) return null;
  return [{ key: "a", label: "Fait" }];
}

/** The yes-or-no choice a recommendation names first: « Oui, … », « non »,
 *  never « Non-bloquant ». */
function yesNoKey(reco: string): string | null {
  const m = /^\s*\(?(oui|non)(?![\p{L}-])/iu.exec(reco);
  if (!m) return null;
  return m[1].toLowerCase() === "oui" ? "a" : "b";
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
 * b) Grande ➡️ b) …`, `… ? Reco : oui.`): its first ➡ after the « ? », or
 * a « Reco : » opening a sentence there, else -1. One before it, or in the
 * body, is the question's own words (`clic ➡️ fiche`, `Ma reco : …`).
 */
function arrowAt(head: string): number {
  const asked = head.indexOf("?");
  if (asked < 0) return -1;
  const arrow = head.indexOf("➡", asked);
  const reco = /[?.!]\s+(\**(?:Reco|Recommandation)\s?\**\s*:)/i.exec(
    head.slice(asked),
  );
  const recoAt = reco
    ? asked + reco.index + reco[0].length - reco[1].length
    : -1;
  const found = [arrow, recoAt].filter((at) => at >= 0);
  return found.length > 0 ? Math.min(...found) : -1;
}

/** The question's line, its recommendation on a line of its own. */
function splitArrow(head: string): string[] {
  const at = arrowAt(head);
  if (at < 0) return [head];
  return [head.slice(0, at).trimEnd(), head.slice(at)];
}

const RULE = /^\s*-{3,}\s*$/;

/**
 * Whether the `**Q1.**` block `[start, end)` asks: a bare « Reco : »
 * (`**Q4.** Les duels : ta sélection…`), or a « ? » before its
 * recommendation or options. Else it is a report: `**Q1.** Fait.` then
 * `➡️ relance le serveur`, or steps `a) b)`.
 */
function numberedAsks(lines: string[], start: number, end: number): boolean {
  const block = [...splitArrow(lines[start]), ...lines.slice(start + 1, end)];
  const advice = block.findIndex((line, i) => i > 0 && ARROW.test(line));
  if (advice > 0 && RECO.test(block[advice])) return true;
  const before = block.slice(0, advice > 0 ? advice : block.length);
  const asked = before.some((line) => !OPTION.test(line) && line.includes("?"));
  return asked && (advice > 0 || optionsIn(block).options.length > 0);
}

/**
 * Each question's lines, `[start, end)`: from its ❓ up to the next ❓, a
 * `---`, or the blank line that closes its ➡️ paragraph (what follows is
 * Claude's own words again). A reply with no ❓ nor « Question n sur N »
 * may ask with `**Q1.**` lines instead; within another format, a `Q1 :`
 * is that question's words. A `❓ Question n sur N` is a series header,
 * never a grilling question.
 */
function grillingBlocks(lines: string[]): [number, number][] {
  const grillMark = (l: string) => QUESTION_MARK.test(l) && !seriesHeader(l);
  const numbered =
    !lines.some(grillMark) && !lines.some((l) => seriesHeader(l));
  const blocks: [number, number][] = [];
  let start = -1;
  let advised = false;
  const close = (end: number) => {
    if (start >= 0 && (!numbered || numberedAsks(lines, start, end)))
      blocks.push([start, end]);
    start = -1;
  };
  lines.forEach((line, i) => {
    if (numbered ? numberedHead(line) : grillMark(line)) {
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

/** A question as its reply reads it, before `parseQuestionRound` keys it. */
type ParsedQuestion = Omit<RoundQuestion, "key">;

/** `❓ **Q1** - **Titre** : corps…` blocks (`grillingBlocks`). */
function grillingRound(lines: string[]): ParsedQuestion[] {
  const blocks = grillingBlocks(lines).map(([start, end]) => [
    ...splitArrow(lines[start]),
    ...lines.slice(start + 1, end),
  ]);
  return blocks.map((block, i) => {
    const head = block[0].replace(QUESTION_MARK, "");
    const number =
      /^\s*(?:#{1,6}\s*)?\**\s*Q\s*(\d+)\s*[.:)]?\s*\**\s*[-–—:.]?\s*/i.exec(
        head,
      );
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
        // A second one adds to the first, never hides it.
        const said = unbold(line.replace(ARROW, ""));
        recommendation =
          recommendation === null ? said : `${recommendation}\n${said}`;
        continue;
      }
      if (recommendation !== null) recommendation += `\n${line}`;
      else body.push(line);
    }
    recommendation = recommendation?.trim() || null;
    const { options, lines: kept } = optionsIn(body);
    const text = kept.join("\n").trim();
    // No bold title: the first line's question is the title, what follows
    // its last « ? » before a word the body (`**Q1.** On publie ? L'image
    // montre…`). A « ? » before « » » or « ) » is a quote's own.
    const [line = "", ...others] = text.split("\n");
    const first = unbold(line);
    const marks = [...first.matchAll(/\?(?=\s+[\p{L}\d])/gu)];
    const asked = marks.length > 0 ? marks[marks.length - 1].index : -1;
    const lead = asked >= 0 ? first.slice(0, asked + 1) : first;
    const more = asked >= 0 ? first.slice(asked + 1).trim() : "";
    const shownBody = title ? text : [more, ...others].join("\n").trim();
    // No options written: the one an action asks for, else Oui / Non when
    // it asks yes or no.
    const asks = `${title || lead}\n${shownBody}`;
    const action =
      options.length === 0 ? actionChoice(asks, recommendation) : null;
    const yesNo = options.length === 0 && !action && closedQuestion(asks);
    const choices = action ?? (yesNo ? YES_NO : options);
    // An action's one choice names no reco: it shows as a choice of its own.
    let recommendedKey: string | null = null;
    if (recommendation && yesNo) recommendedKey = yesNoKey(recommendation);
    else if (recommendation && !action)
      recommendedKey = namedKey(recommendation, options);
    return {
      id: `Q${number?.[1] ?? i + 1}`,
      numbered: !!number,
      title: title || lead,
      body: shownBody,
      options: choices,
      recommendation,
      recommendedKey,
    };
  });
}

/**
 * « Question n sur N. » at `start`, context, the question, `a) b) c)`, the
 * leaning, up to `stop` (the next one): the question, and its lines
 * `[start, end)`, down to the leaning (else its options). What follows is
 * Claude's own words again.
 */
function seriesRead(
  lines: string[],
  start: number,
  stop: number,
): { question: ParsedQuestion; start: number; end: number } | null {
  const [, n, , context] = seriesHeader(lines[start])!;
  // `after[0]` is line `start + skip`: the header's own context, if any.
  const skip = context ? 0 : 1;
  const after = [
    ...(context ? [context] : []),
    ...lines.slice(start + 1, stop),
  ];
  // The options come before the leaning, whose « (a) » is none.
  const leanAt = after.findIndex(isLeaning);
  const scope = leanAt >= 0 ? after.slice(0, leanAt) : after;
  const found = optionsIn(scope);
  if (found.options.length === 0)
    return QUESTION_MARK.test(lines[start])
      ? bareSeriesRead(n, after, start, start + skip)
      : null;
  const last = leanAt >= 0 ? leanAt : found.lastAt;
  const { options, lines: kept } = optionsIn(scope.slice(0, last + 1));
  const lean = leanAt >= 0 ? leaningOf(after[leanAt], options) : null;
  const recommendedKey = lean?.key ?? null;
  const recommendation = lean?.recommendation ?? null;
  const prose = kept.filter((line) => line.trim()).map(unbold);
  // The question is its line ending with « ? », the rest is context.
  let qi = -1;
  prose.forEach((l, i) => {
    if (l.trimEnd().endsWith("?")) qi = i;
  });
  // « Question 2 sur 2 : réglée. » then steps `a.` `b.`: a report, not
  // an ask. Words on the header's line take a « ? » to count.
  if (context && qi < 0) return null;
  const title = qi >= 0 ? prose[qi] : (prose[0] ?? "");
  return {
    question: {
      id: `Q${n}`,
      numbered: true,
      title,
      body: prose.filter((_, i) => i !== (qi >= 0 ? qi : 0)).join("\n"),
      options,
      recommendation,
      recommendedKey,
    },
    start,
    end: start + skip + last + 1,
  };
}

/**
 * A ❓ « Question n sur N » Claude wrote no options for (the user's ask of
 * 12/11/2026), `after` its lines from line `from`: its question is its last
 * line ending with a « ? » (before its leaning), code aside; with none, the
 * line asking a word back. That word for an action, else Oui / Non when it
 * asks yes or no, or its leaning says oui / non. With neither, the header
 * heads a report.
 */
function bareSeriesRead(
  n: string,
  after: string[],
  start: number,
  from: number,
): { question: ParsedQuestion; start: number; end: number } | null {
  const leanAt = after.findIndex(isLeaning);
  const scope = leanAt >= 0 ? after.slice(0, leanAt) : after;
  const code = inCode(scope);
  let qi = -1;
  scope.forEach((l, i) => {
    if (!code[i] && endsAsking(unbold(l))) qi = i;
  });
  if (qi < 0)
    qi = scope.findIndex((l, i) => !code[i] && REPLY_WORD.test(unbold(l)));
  if (qi < 0) return null;
  const line = unbold(scope[qi]).trim();
  const saysYesNo = leanAt >= 0 && YES_NO_LEANING.test(after[leanAt]);
  const options =
    actionChoice(line, null) ??
    (saysYesNo || closedQuestion(line) ? YES_NO : []);
  const lean = leanAt >= 0 ? leaningOf(after[leanAt], options) : null;
  // Every line it takes from the message shows, the question's aside.
  const last = leanAt >= 0 ? leanAt : qi + 1;
  return {
    question: {
      id: `Q${n}`,
      numbered: true,
      title: line,
      body: scope
        .slice(0, last)
        .filter((l, i) => i !== qi && l.trim())
        .map(unbold)
        .join("\n"),
      options,
      recommendation: lean?.recommendation ?? null,
      recommendedKey: lean?.key ?? null,
    },
    start,
    end: from + (leanAt >= 0 ? leanAt : qi) + 1,
  };
}

/** Every « Question n sur N » of a reply: one message may ask several. */
function seriesReads(lines: string[]) {
  const starts = lines.flatMap((l, i) => (seriesHeader(l) ? [i] : []));
  return starts.flatMap((start, k) => {
    const read = seriesRead(lines, start, starts[k + 1] ?? lines.length);
    return read ? [read] : [];
  });
}

function seriesQuestion(lines: string[]): ParsedQuestion[] {
  return seriesReads(lines).map((read) => read.question);
}

function seriesBlock(lines: string[]): [number, number][] {
  return seriesReads(lines).map((read) => [read.start, read.end]);
}

const linesOf = (text: string) => text.replace(/\r\n/g, "\n").split("\n");
const isGrilling = (lines: string[]) => grillingBlocks(lines).length > 0;

/** The questions of a reply, or none when it asks no round. `replyId`:
 *  the reply's item, which their `key`s name. */
export function parseQuestionRound(
  text: string,
  replyId = "",
): RoundQuestion[] {
  const lines = linesOf(text);
  const questions = isGrilling(lines)
    ? grillingRound(lines)
    : seriesQuestion(lines);
  return questions.map((q, i) => ({ ...q, key: `${replyId}#${i + 1}` }));
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

// Read on each event of a turn now: a finished reply is parsed once.
const parsed = new WeakMap<
  object,
  { text: string; questions: RoundQuestion[] }
>();

function replyQuestions(item: { id: string; text: string }): RoundQuestion[] {
  const kept = parsed.get(item);
  if (kept?.text === item.text) return kept.questions;
  const questions = parseQuestionRound(item.text, item.id);
  parsed.set(item, { text: item.text, questions });
  return questions;
}

/**
 * The round Claude asks since the user's last message, finished: the
 * questions of every reply since then, in order, a question asked again
 * taking its new words (the user's report of 01/11/2026: Q8 to Q11 in one
 * message, a subagent's report, Q12 in another, « J'attends tes réponses »
 * last). `id` names the first reply that asks, so answers and a closed
 * sheet stay as later replies add questions; `ids` are all those replies.
 * Only Claude's number names a question across replies: one he left
 * unnumbered stays its reply's own, never taking another's place.
 * A reply still being written counts once finished: the round asked before
 * it stays meanwhile (the user's choice of 02/11/2026: a subagent's report
 * woke Claude and the sheet vanished under his finger).
 */
export function lastReplyRound(
  items: readonly ChatItem[],
): { id: string; ids: string[]; questions: RoundQuestion[] } | null {
  const replies: { id: string; questions: RoundQuestion[] }[] = [];
  let latest = true;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "user" || item.kind === "command") break;
    if (item.kind !== "text") continue;
    if (item.streaming) {
      latest = false;
      continue;
    }
    // His last word an error: no sheet.
    if (latest && item.error) return null;
    latest = false;
    if (item.error) continue;
    const questions = replyQuestions(item);
    if (questions.length > 0) replies.unshift({ id: item.id, questions });
  }
  if (replies.length === 0) return null;
  const bySlot = new Map<string, RoundQuestion>();
  for (const reply of replies)
    for (const q of reply.questions) bySlot.set(q.numbered ? q.id : q.key, q);
  return {
    id: replies[0].id,
    ids: replies.map((r) => r.id),
    questions: [...bySlot.values()],
  };
}

/**
 * Whether the round `roundId` shows: always at rest; while Claude works,
 * only the one up when his turn started (`restRound`, noted by
 * `startTurn`). The desktop's `sheetUp` and the phone's `phoneAsk` share it.
 */
export function roundShowsNow(
  working: boolean,
  roundId: string | null,
  restRound: string | null,
): boolean {
  return roundId !== null && (!working || roundId === restRound);
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

/**
 * The next question left, `answered[i]` telling question i has an answer:
 * after `step` first, then from the start; never `step` itself. Null when
 * every other question has its answer.
 */
export function nextQuestionLeft(
  answered: readonly boolean[],
  step: number,
): number | null {
  const left = (i: number) => i !== step && !answered[i];
  const order = answered.map((_, i) => i);
  return order.find((i) => i > step && left(i)) ?? order.find(left) ?? null;
}

/**
 * Where Enter in a question's own-words field leads: on to the next question
 * left, never the round sent before (the user's ask of 02/11/2026). With
 * every question answered, it sends; else, nothing left to go to, it stays.
 */
export function enterLeadsTo(
  answered: readonly boolean[],
  step: number,
): number | "send" | null {
  const next = nextQuestionLeft(answered, step);
  if (next !== null) return next;
  return answered.every(Boolean) ? "send" : null;
}

/**
 * Where the button at the field's end leads: on to the next question left
 * after this one; with none after it, the answers go, a part if one was
 * skipped (the user's report of 03/11/2026: it sent from the 3rd question
 * of 5, the last two never answered).
 */
export function buttonLeadsTo(
  answered: readonly boolean[],
  step: number,
): number | "send" {
  const next = answered.findIndex((done, i) => i > step && !done);
  return next >= 0 ? next : "send";
}

/**
 * One line per answered question, `answers` by `key`: `Q1 : b) Label, mes
 * mots`. A question Claude left unnumbered goes by its title: its place
 * in its reply could name another reply's question.
 */
export function roundReply(
  questions: readonly RoundQuestion[],
  answers: Readonly<Record<string, RoundAnswer>>,
): string {
  return questions
    .flatMap((q) => {
      const a = answers[q.key];
      if (!a) return [];
      const option = q.options.find((o) => o.key === a.option);
      const parts = [
        a.reco ? "OK pour ta reco" : null,
        option ? `${option.key}) ${option.label}` : null,
        a.text?.trim() || null,
      ].filter(Boolean);
      const name = q.numbered ? q.id : q.title || q.id;
      return parts.length > 0 ? [`${name} : ${parts.join(", ")}`] : [];
    })
    .join("\n");
}
