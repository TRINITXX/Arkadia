// The handoff (« passation »): a chat whose session went cold (its prompt
// cache expired) with a big context would send that whole context again at
// its next message, written to the cache at twice the input price. That
// message goes instead to a new session that starts from a handoff: Opus
// writes it from the old conversation's words alone (prompts and replies, no
// tool output nor file content: 1/4 to 1/14 of the context on 8 big sessions,
// measured 03/11/2026), and `transcript.ts` reads the rest of the old
// transcript on demand. Pure: the chat server reads the file and calls Opus.

/** Below this, a cold session is resumed as it is (Alexis, 03/11/2026). */
export const HANDOFF_MIN_TOKENS = 300_000;
const MINUTE = 60_000;
/** The prompt cache's two lives: what a session's last write asked for. */
const TTL_1H = 60 * MINUTE;
const TTL_5M = 5 * MINUTE;
/** The words handed to the writer at most (~115 k tokens): their start and end kept. */
export const WORDS_MAX_CHARS = 400_000;
/** The last exchange, quoted as is in the handoff: each side at most this long. */
const LAST_MAX_CHARS = 4_000;
/** The files listed for the writer at most, the latest touched kept. */
const FILES_MAX = 60;

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
  let facts: ColdFacts | null = null;
  let ttlMs = TTL_1H;
  for (const e of entries) {
    if (e.isSidechain) continue;
    const at = Date.parse(e.timestamp ?? "");
    if (Number.isNaN(at)) continue;
    if (isBoundary(e)) {
      facts = { tokens: e.compactMetadata?.postTokens ?? 0, at, ttlMs };
      continue;
    }
    const usage = e.type === "assistant" ? e.message?.usage : undefined;
    if (!usage) continue;
    const written = usage.cache_creation;
    if ((written?.ephemeral_1h_input_tokens ?? 0) > 0) ttlMs = TTL_1H;
    else if ((written?.ephemeral_5m_input_tokens ?? 0) > 0) ttlMs = TTL_5M;
    const tokens =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    facts = { tokens, at, ttlMs };
  }
  return facts;
}

/** A transcript written within this is warm: the shortest cache lives 5 min. */
export const COLD_MIN_IDLE_MS = 5 * MINUTE;

/**
 * What may open a handoff, known without reading the transcript: a message
 * (a slash command, /compact or /usage, runs on the session as it is), not
 * resumed « en entier », no rewind's cut, the transcript left 5 min.
 */
export function mayHandOff(text: string, whole: boolean, rewound: boolean, idleMs: number): boolean {
  return !whole && !rewound && !text.trimStart().startsWith("/") && idleMs >= COLD_MIN_IDLE_MS;
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
  if (typeof content === "string") return isNote(content) ? null : [{ who: "user", text: content }];
  const blocks = blocksOf(content);
  if (blocks.some((b) => b.type === "tool_result")) return null;
  const said: Said[] = [];
  for (const b of blocks) {
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (b.type !== "text" || !text || isNote(text) || /^\[Image #\d+\]$/.test(text)) continue;
    // A handoff this session started from: the summary of what came before.
    said.push({ who: text.startsWith(HANDOFF_OPEN) ? "summary" : "user", text });
  }
  return said.length > 0 ? said : null;
}

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

/**
 * The words as the writer reads them. Past `max`, the first turn (the
 * goal, most often) and the latest ones are kept, the middle said cut.
 */
export function wordsText(said: readonly Said[], max = WORDS_MAX_CHARS): string {
  const parts = said.map((s) => `${HEADINGS[s.who]}\n${s.text}`);
  const whole = parts.join("\n\n");
  if (whole.length <= max || parts.length === 0) return whole.slice(-max);
  const head = parts[0].slice(0, Math.floor(max / 4));
  const cut = "\n\n[… le milieu de la conversation est coupé …]\n\n";
  let tail = "";
  for (let i = parts.length - 1; i > 0; i--) {
    const next = tail ? `${parts[i]}\n\n${tail}` : parts[i];
    if (head.length + cut.length + next.length > max) break;
    tail = next;
  }
  return `${head}${cut}${tail}`;
}

const EDITING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** The files Claude wrote, the latest touched last, at most `FILES_MAX`. */
export function filesTouched(entries: readonly Entry[]): string[] {
  const files = new Map<string, true>();
  for (const e of entries) {
    if (e.isSidechain || e.type !== "assistant") continue;
    for (const b of blocksOf(e.message?.content)) {
      if (b.type !== "tool_use" || !EDITING_TOOLS.has(String(b.name))) continue;
      const input = (b.input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
      const path = input.file_path ?? input.notebook_path;
      if (typeof path !== "string") continue;
      files.delete(path);
      files.set(path, true);
    }
  }
  return [...files.keys()].slice(-FILES_MAX);
}

/** The writer's instructions: its system prompt replaces Claude Code's. */
export const WRITER_SYSTEM =
  "Tu rédiges des passations entre deux conversations de Claude Code. Tu écris en français, " +
  "court et précis, sans rien inventer : ce qui n'est pas dans la conversation n'existe pas.";

/** What the writer gets: the words, the files touched, what to write. */
export function writerPrompt(words: string, files: readonly string[]): string {
  return [
    "Voici une conversation entre Alexis et Claude, texte seul : les sorties d'outils et le contenu des fichiers en sont retirés.",
    "Elle continue dans une nouvelle conversation qui ne la voit pas. Écris la passation qui permet à Claude d'y reprendre exactement où elle s'est arrêtée.",
    "",
    "Sections, dans cet ordre, en puces courtes :",
    "## But",
    "## Décisions prises (avec leur raison quand elle est dite : elles ne se rouvrent pas)",
    "## Fait",
    "## Reste à faire (dans l'ordre)",
    "## Questions ouvertes et attentes d'Alexis",
    "## Détails techniques utiles (chemins, commandes, pièges rencontrés, chiffres)",
    "",
    "Ne recopie pas le dernier échange : il est ajouté tel quel après ta passation. Réponds avec la passation seule.",
    "",
    "<fichiers_modifies>",
    files.length > 0 ? files.join("\n") : "(aucun)",
    "</fichiers_modifies>",
    "",
    "<conversation>",
    words,
    "</conversation>",
  ].join("\n");
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)} […]`);

/** The last thing the user said and Claude's reply to it, quoted as is. */
export function lastExchange(said: readonly Said[]): string {
  const userAt = said.map((s) => s.who).lastIndexOf("user");
  if (userAt < 0) return "";
  const reply = said.slice(userAt + 1).find((s) => s.who === "claude");
  const lines = [`**Alexis** : ${clip(said[userAt].text, LAST_MAX_CHARS)}`];
  if (reply) lines.push(`**Claude** : ${clip(reply.text, LAST_MAX_CHARS)}`);
  return lines.join("\n\n");
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

/** About 3.5 characters a token, in French with code. */
export const tokensOf = (text: string) => Math.round(text.length / 3.5);

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
  const summary = /<passation>\n?([\s\S]*?)\n?<\/passation>/.exec(text)?.[1] ?? "";
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
  return text;
}

/** The handoff's summary: what Opus wrote, then the last exchange as is. */
export function handoffSummary(written: string, said: readonly Said[]): string {
  const last = lastExchange(said);
  return last ? `${written.trim()}\n\n## Dernier échange (mot pour mot)\n\n${last}` : written.trim();
}
