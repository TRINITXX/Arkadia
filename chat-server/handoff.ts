// The handoff (« passation »): a chat whose session went cold (its prompt
// cache expired) with a big context would send that whole context again at
// its next message, written to the cache at twice the input price. That
// message goes instead to a new session that starts from a handoff: Opus
// writes it as Claude Code's own compaction would (its 9 sections, the
// latest exchanges kept as is), from the old conversation without its tool
// outputs (a fraction of the context), and `transcript.ts` reads the rest
// of the old transcript on demand. Pure: the chat server reads the file and calls Opus.

/** Below this, a cold session is resumed as it is (Alexis, 03/11/2026). */
export const HANDOFF_MIN_TOKENS = 300_000;
const MINUTE = 60_000;
/** The prompt cache's two lives: what a session's last write asked for. */
const TTL_1H = 60 * MINUTE;
const TTL_5M = 5 * MINUTE;
/** The digest handed to the writer at most (~120 k tokens): its start and end kept. */
export const DIGEST_MAX_CHARS = 240_000;
/** A code change or a tool's error, at most this long in the digest. */
const EDIT_MAX_CHARS = 2_500;
const ERROR_MAX_CHARS = 600;
/** The latest exchanges quoted as is after the summary: how many, each message and all at most this long. */
const RECENT_EXCHANGES = 10;
const LAST_MAX_CHARS = 4_000;
const RECENT_MAX_CHARS = 40_000;

export interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

/** A line of a session's .jsonl, as far as the handoff and `transcript.ts` read it. */
export interface Entry {
  type?: string;
  subtype?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  compactMetadata?: { postTokens?: number };
  message?: { content?: unknown; usage?: Usage };
}

/** The lines of a .jsonl that parse; the others (a line cut mid-write) are skipped. */
export function parseEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object") entries.push(value as Entry);
    } catch {
      // A torn line: not a message.
    }
  }
  return entries;
}

/** What says whether the next message would rewrite the whole cache. */
export interface ColdFacts {
  /** The context its last request read (or what a compaction after it left). */
  tokens: number;
  /** When that request (or compaction) was, in ms. */
  at: number;
  /** How long the cache it wrote lives. */
  ttlMs: number;
}

const blocksOf = (content: unknown): Record<string, unknown>[] =>
  Array.isArray(content)
    ? content.filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    : [];

const isBoundary = (e: Entry) => e.type === "system" && e.subtype === "compact_boundary";

/**
 * The session's context and the time of its last request, from its last
 * usage; a compaction after it rules. Its cache lives 1 h unless its writes
 * asked for 5 min; never seen, 1 h (the later handoff, when unsure).
 */
export function coldFacts(entries: readonly Entry[]): ColdFacts | null {
  // Cast, not annotated: assigned in the loop alone, TS would narrow it to never.
  let facts = null as ColdFacts | null;
  for (const e of entries) {
    if (e.isSidechain) continue;
    const at = Date.parse(e.timestamp ?? "");
    if (Number.isNaN(at)) continue;
    if (isBoundary(e)) {
      facts = { tokens: e.compactMetadata?.postTokens ?? 0, at, ttlMs: facts?.ttlMs ?? TTL_1H };
      continue;
    }
    const usage = e.type === "assistant" ? e.message?.usage : undefined;
    if (usage) facts = nextFacts(facts, usage, at);
  }
  return facts;
}

/**
 * The facts after one more request of the session (its usage, at `at`): the
 * chat server keeps them so as its requests go, the transcript read only for
 * a session it never saw work (a chat restored at Arkadia's start).
 */
export function nextFacts(prev: ColdFacts | null, usage: Usage, at: number): ColdFacts | null {
  const tokens =
    (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  // No request read anything: Claude Code's own answer (/usage, /context, an
  // API error, the 5-hour limit: a « <synthetic> » message, usage all zero).
  if (tokens === 0) return prev;
  const written = usage.cache_creation;
  let ttlMs = prev?.ttlMs ?? TTL_1H;
  if ((written?.ephemeral_1h_input_tokens ?? 0) > 0) ttlMs = TTL_1H;
  else if ((written?.ephemeral_5m_input_tokens ?? 0) > 0) ttlMs = TTL_5M;
  return { tokens, at, ttlMs };
}

/**
 * What may open a handoff, known without reading anything: a message (a
 * slash command, /compact or /usage, runs on the session as it is), not
 * resumed « en entier », no rewind's cut. Never the transcript's date: Claude
 * Code writes its bookkeeping there as it starts, with no request (a cold
 * session woken by a key looked warm, 03/11/2026).
 */
export function mayHandOff(text: string, whole: boolean, rewound: boolean): boolean {
  return !whole && !rewound && !text.trimStart().startsWith("/");
}

/** A big session whose cache expired: its next message goes to a handoff. */
export function handoffDue(facts: ColdFacts | null, now: number): boolean {
  return facts !== null && facts.tokens >= HANDOFF_MIN_TOKENS && now - facts.at > facts.ttlMs;
}

/** A turn of the conversation: the user's, Claude's, or a summary of what came before. */
export interface Said {
  who: "user" | "claude" | "summary";
  text: string;
}

const HANDOFF_OPEN = "<arkadia-handoff";
const HANDOFF_CLOSE = "</arkadia-handoff>";

/** Claude Code's own lines in the user's turn: a command's output, a reminder, a notification. */
const isNote = (text: string) =>
  text.startsWith("<") && !text.startsWith("<pasted") && !text.startsWith(HANDOFF_OPEN);

/** The user's words in an entry, or null: a tool result, a note of Claude Code's. */
function userWords(content: unknown): Said[] | null {
  if (typeof content === "string") return isNote(content) || isMark(content) ? null : [{ who: "user", text: content }];
  const blocks = blocksOf(content);
  if (blocks.some((b) => b.type === "tool_result")) return null;
  const said: Said[] = [];
  const typed: string[] = [];
  for (const b of blocks) {
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (b.type !== "text" || !text || isNote(text) || isMark(text) || /^\[Image #\d+\]$/.test(text)) continue;
    // A handoff this session started from: the summary of what came before.
    if (text.startsWith(HANDOFF_OPEN)) said.push({ who: "summary", text });
    else typed.push(text);
  }
  // One message, however many blocks: one exchange.
  if (typed.length > 0) said.push({ who: "user", text: typed.join("\n") });
  return said.length > 0 ? said : null;
}

/** Claude Code's marks in the user's turn (« [Request interrupted by user] »): not the user's words. */
const isMark = (text: string) => text.startsWith("[Request interrupted");

/**
 * What was said since the last compaction (its summary first): the user's
 * prompts and Claude's replies, in order, without tools nor thinking.
 */
export function conversationWords(entries: readonly Entry[]): Said[] {
  let said: Said[] = [];
  for (const e of entries) {
    if (e.isSidechain) continue;
    if (isBoundary(e)) {
      said = [];
      continue;
    }
    const content = e.message?.content;
    if (e.type === "user" && e.isCompactSummary) {
      const text = typeof content === "string" ? content : blocksOf(content).map((b) => b.text ?? "").join("\n");
      said.push({ who: "summary", text });
    } else if (e.type === "user" && !e.isMeta) {
      said.push(...(userWords(content) ?? []));
    } else if (e.type === "assistant") {
      const text = blocksOf(content)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => (b.text as string).trim())
        .filter(Boolean)
        .join("\n\n");
      if (!text) continue;
      const last = said[said.length - 1];
      // One reply comes in several entries: one turn of Claude's.
      if (last?.who === "claude") said[said.length - 1] = { who: "claude", text: `${last.text}\n\n${text}` };
      else said.push({ who: "claude", text });
    }
  }
  return said;
}

const HEADINGS: Record<Said["who"], string> = {
  user: "### Alexis",
  claude: "### Claude",
  summary: "### Résumé de ce qui précédait",
};

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)} […]`);

/**
 * Parts past `max` characters: the first (the goal, most often) and the
 * latest ones kept, the middle said cut.
 */
function withinBudget(parts: readonly string[], max: number): string {
  const whole = parts.join("\n\n");
  if (whole.length <= max || parts.length === 0) return whole.slice(-max);
  const head = parts[0].slice(0, Math.floor(max / 4));
  const cut = "\n\n[… le milieu de la conversation est coupé …]\n\n";
  let tail = "";
  for (let i = parts.length - 1; i > 0; i--) {
    const next = tail ? `${parts[i]}\n\n${tail}` : parts[i];
    if (head.length + cut.length + next.length > max) {
      // A part too long for what is left (a long log pasted): its start, not nothing.
      const room = max - head.length - cut.length - tail.length - 10;
      if (room > 200) tail = tail ? `${clip(parts[i], room)}\n\n${tail}` : clip(parts[i], room);
      break;
    }
    tail = next;
  }
  return `${head}${cut}${tail}`;
}

/** What a call was about, in a few words: its command, file, pattern or task. */
function subjectOf(input: Record<string, unknown>): string {
  const subject =
    input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.description ?? input.url ?? input.query;
  return (typeof subject === "string" ? subject : JSON.stringify(input)).replace(/\s+/g, " ").slice(0, 200);
}

/** The new code of a code change, or undefined for any other call. */
function newCode(name: string, input: Record<string, unknown>): string | undefined {
  if (name === "Edit" && typeof input.new_string === "string") return input.new_string;
  if (name === "Write" && typeof input.content === "string") return input.content;
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.map((edit) => String((edit as { new_string?: unknown }).new_string ?? "")).join("\n…\n");
  }
  return undefined;
}

const FENCE = "```";

/** A tool call in the digest: one line, a code change with its new code. */
function callPart(block: Record<string, unknown>): string {
  const name = String(block.name ?? "?");
  const input = (block.input ?? {}) as Record<string, unknown>;
  const line = `→ ${name} · ${subjectOf(input)}`;
  const code = newCode(name, input);
  return code ? `${line}\n${FENCE}\n${clip(code, EDIT_MAX_CHARS)}\n${FENCE}` : line;
}

/** A tool result's text, its text blocks joined. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .map((b) => (b.type === "text" ? String(b.text ?? "") : ""))
    .join("\n");
}

/**
 * The old conversation as the writer reads it, since its last compaction
 * (that summary first): the user's messages and Claude's replies whole,
 * each tool call in a line, a code change with its new code, a tool's
 * error, never a tool's output (a file read, a command's output): what
 * Claude Code's own compaction reads, without what can be read again.
 */
export function conversationDigest(entries: readonly Entry[], max = DIGEST_MAX_CHARS): string {
  let parts: string[] = [];
  let claudeAt = -1;
  for (const e of entries) {
    if (e.isSidechain) continue;
    if (isBoundary(e)) {
      parts = [];
      claudeAt = -1;
      continue;
    }
    const content = e.message?.content;
    if (e.type === "user" && e.isCompactSummary) {
      const text = typeof content === "string" ? content : blocksOf(content).map((b) => b.text ?? "").join("\n");
      parts.push(`${HEADINGS.summary}\n${text}`);
      claudeAt = -1;
    } else if (e.type === "user" && !e.isMeta) {
      for (const b of blocksOf(content)) {
        if (b.type === "tool_result" && b.is_error === true) {
          parts.push(`  ✗ erreur : ${clip(resultText(b.content).trim(), ERROR_MAX_CHARS)}`);
        }
      }
      for (const s of userWords(content) ?? []) {
        parts.push(`${HEADINGS[s.who]}\n${s.text}`);
        claudeAt = -1;
      }
    } else if (e.type === "assistant") {
      for (const b of blocksOf(content)) {
        const text = typeof b.text === "string" ? b.text.trim() : "";
        if (b.type === "text" && text) {
          // One reply comes in several entries: one turn of Claude's.
          if (claudeAt >= 0 && claudeAt === parts.length - 1) parts[claudeAt] += `\n\n${text}`;
          else {
            parts.push(`${HEADINGS.claude}\n${text}`);
            claudeAt = parts.length - 1;
          }
        } else if (b.type === "tool_use") {
          parts.push(callPart(b));
        }
      }
    }
  }
  return withinBudget(parts, max);
}

/** The writer's instructions: its system prompt replaces Claude Code's. */
export const WRITER_SYSTEM =
  "Tu résumes une conversation de Claude Code pour qu'elle continue dans une nouvelle, comme le fait la compaction de Claude Code. " +
  "Tu écris en français, sans rien inventer : ce qui n'est pas dans la conversation n'existe pas.";

/**
 * What the writer gets: the digest, and what to write: the sections and
 * the rules of Claude Code's own compaction (2.1.317), in French.
 */
export function writerPrompt(digest: string): string {
  return [
    "Voici une conversation entre Alexis et Claude. Ses messages et les réponses de Claude sont entiers ; chaque appel d'outil tient en une ligne, une modification de code montre le nouveau code (tronqué), une erreur d'outil son message ; les sorties d'outils (fichiers lus, résultats de commandes) sont retirées.",
    "Elle continue dans une nouvelle conversation qui ne la voit pas. Écris le résumé qui permet d'y reprendre le travail sans rien refaire ni rien redemander à Alexis.",
    "",
    "Préserve, quitte à être long : (1) les difficultés rencontrées et comment elles ont été traitées ; (2) les options proposées, essayées ou écartées, et pourquoi ; (3) tout ce qu'Alexis a demandé, décidé, accepté, exclu ou posé comme préférence ou contrainte, au plus près de ses mots ; (4) où en est exactement le travail ; (5) ce qui reste ouvert, promis ou attendu ; (6) les détails difficiles à retrouver : noms, chiffres, dates, formulations exactes, liens, chemins, noms de fonctions, messages d'erreur. Complet sur ces six points, concis sur le reste. Garde les mots d'Alexis au plus près ; condense les explications de Claude à ce qu'elles ont conclu ou produit.",
    "",
    "Sections, dans cet ordre :",
    "1. Demande principale et intention",
    "2. Notions techniques clés",
    "3. Fichiers et code : chaque fichier examiné, modifié ou créé, pourquoi il compte, les extraits utiles",
    "4. Erreurs et corrections",
    "5. Problèmes résolus et recherches en cours",
    "6. Tous les messages d'Alexis (hors résultats d'outils), fidèles, ses consignes et contraintes mot pour mot",
    "7. Tâches en attente",
    "8. Travail en cours juste avant la coupure, précisément",
    "9. Prochaine étape, avec des citations du dernier échange",
    "",
    "Les derniers échanges sont ajoutés mot pour mot après ton résumé. Écris le résumé dans <summary></summary>, rien d'autre.",
    "",
    "<conversation>",
    digest,
    "</conversation>",
  ].join("\n");
}

/**
 * The last `n` exchanges (the user's messages and Claude's replies), quoted
 * as is, as Claude Code's compaction keeps its latest messages. Each message
 * at most `LAST_MAX_CHARS`, all of them at most `RECENT_MAX_CHARS`, the
 * latest kept.
 */
export function recentExchanges(said: readonly Said[], n = RECENT_EXCHANGES): string {
  const users = said.flatMap((s, i) => (s.who === "user" ? [i] : []));
  if (users.length === 0) return "";
  const from = users[Math.max(0, users.length - n)];
  const parts = said
    .slice(from)
    .filter((s) => s.who !== "summary")
    .map((s) => `**${s.who === "user" ? "Alexis" : "Claude"}** : ${clip(s.text, LAST_MAX_CHARS)}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (size + parts[i].length > RECENT_MAX_CHARS) break;
    kept.unshift(parts[i]);
    size += parts[i].length + 2;
  }
  return kept.join("\n\n");
}

/** What the page keeps of a handoff: the old session, its size, what Claude knows of it. */
export interface HandoffInfo {
  /** The old session's id: « Reprendre l'ancienne en entier » resumes it. */
  from: string;
  /** Its context when it went cold. */
  before: number;
  /** The handoff Claude got: the summary and the last exchange. */
  summary: string;
}

/**
 * What the page hears of a handoff, by its separator's id: `running` while
 * Opus writes it, `done` with what Claude got, `failed` and the chat resumes
 * its session as it is.
 */
export type HandoffEvent =
  | { type: "handoff"; chatId: string; id: string; phase: "running"; before: number }
  | ({ type: "handoff"; chatId: string; id: string; phase: "done"; after: number } & HandoffInfo)
  | { type: "handoff"; chatId: string; id: string; phase: "failed"; error: string };

/** Claude Code's folder for a working folder's sessions: every other character a dash. */
export const projectFolder = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

/** About 2 characters a token, in French with code (measured 03/11/2026: 126 k characters, 65 k tokens). */
export const tokensOf = (text: string) => Math.round(text.length / 2);

const k = (tokens: number) => `${Math.round(tokens / 1000)} k`;

/**
 * The text that opens the new session, before the user's message: the
 * handoff, and how to read the old transcript. The page reads it back
 * from a resumed session's history (`readHandoffBlock`).
 */
export function handoffBlock(
  info: HandoffInfo,
  transcript: string,
  tool: string,
): string {
  return [
    `${HANDOFF_OPEN} from="${info.from}" tokens="${info.before}">`,
    `Cette conversation prend la suite d'une conversation précédente (${k(info.before)} tokens) dont le cache avait expiré. Tu ne la vois pas : voici sa passation.`,
    "",
    "<passation>",
    info.summary,
    "</passation>",
    "",
    `Transcription complète de l'ancienne conversation, sorties d'outils comprises : ${transcript}`,
    "Relis-la seulement quand un détail manque, chaque lecture coûte :",
    `- node "${tool}" list "${transcript}" [filtre] : ses appels d'outils, une ligne chacun`,
    `- node "${tool}" show "${transcript}" <n> : l'appel n en entier, avec sa sortie`,
    `- node "${tool}" grep "${transcript}" <motif> : les passages qui contiennent le motif`,
    HANDOFF_CLOSE,
  ].join("\n");
}

/** A handoff block's facts, or null for any other text. */
export function readHandoffBlock(text: string): HandoffInfo | null {
  const head = /^<arkadia-handoff from="([^"]*)" tokens="(\d+)">/.exec(text);
  if (!head) return null;
  // To the last closing tag: the summary may quote the tag itself (a session on this code).
  const summary = /<passation>\n?([\s\S]*)<\/passation>/.exec(text)?.[1].replace(/\n$/, "") ?? "";
  return { from: head[1], before: Number(head[2]), summary };
}

/**
 * What Opus wrote, from its turn's result, or an error. A refused request
 * ends « success » too, its error as the text (seen 03/11/2026: « You've
 * hit your 5-hour limit » taken for a handoff): `is_error` tells them apart.
 */
export function writtenHandoff(result: { subtype: string; is_error?: boolean; result?: string }): string {
  const text = result.result?.trim() ?? "";
  if (result.is_error || result.subtype !== "success") throw new Error(text || result.subtype);
  if (!text) throw new Error("passation vide");
  // From the first opening tag to the last closing one: the summary may quote the tags.
  const open = text.indexOf("<summary>");
  if (open < 0) return text;
  const close = text.lastIndexOf("</summary>");
  const inner = text.slice(open + "<summary>".length, close > open ? close : undefined).trim();
  return inner || text;
}

/** The handoff's summary: what Opus wrote, then the latest exchanges as is. */
export function handoffSummary(written: string, said: readonly Said[]): string {
  const recent = recentExchanges(said);
  return recent ? `${written.trim()}\n\n## Derniers échanges (mot pour mot)\n\n${recent}` : written.trim();
}
