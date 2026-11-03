// Reads an old session's transcript on demand, for the session a handoff
// started (`handoff.ts`): its tool calls one line each, one call whole with
// its output, or the passages holding a word. Claude runs it with Node:
//   node transcript.ts list <file.jsonl> [filter]
//   node transcript.ts show <file.jsonl> <n> [from]
//   node transcript.ts grep <file.jsonl> <pattern>
// Each answer is bounded: what is read costs tokens.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { conversationWords, parseEntries, type Entry } from "./handoff.ts";

/** One call's whole text at most; `from` reads on. */
export const SHOW_MAX_CHARS = 40_000;
/** The matches `grep` gives at most, and the text around each. */
const GREP_MAX = 60;
const GREP_AROUND = 120;
/** The lines `list` gives at most: the latest kept. */
const LIST_MAX = 400;

export interface Call {
  /** Its number in the session, from 1. */
  n: number;
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
}

const blocksOf = (content: unknown): Record<string, unknown>[] =>
  Array.isArray(content)
    ? content.filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    : [];

/** A tool result's text: its text blocks, an image said. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .map((b) => (b.type === "text" ? String(b.text ?? "") : b.type === "image" ? "[image]" : ""))
    .join("\n");
}

/** The main thread's tool calls, in order, each with its result once it came. */
export function toolCalls(entries: readonly Entry[]): Call[] {
  const calls: Call[] = [];
  const byId = new Map<string, Call>();
  for (const e of entries) {
    if (e.isSidechain) continue;
    for (const b of blocksOf(e.message?.content)) {
      if (e.type === "assistant" && b.type === "tool_use") {
        const call: Call = {
          n: calls.length + 1,
          name: String(b.name ?? "?"),
          input: (b.input ?? {}) as Record<string, unknown>,
          result: "",
          isError: false,
        };
        calls.push(call);
        byId.set(String(b.id), call);
      } else if (e.type === "user" && b.type === "tool_result") {
        const call = byId.get(String(b.tool_use_id));
        if (!call) continue;
        call.result = resultText(b.content);
        call.isError = b.is_error === true;
      }
    }
  }
  return calls;
}

/** What a call was about, in a few words: its command, file, pattern or task. */
export function callSubject(call: Call): string {
  const i = call.input;
  const subject = i.command ?? i.file_path ?? i.notebook_path ?? i.pattern ?? i.description ?? i.url ?? i.query;
  const text = typeof subject === "string" ? subject : JSON.stringify(i);
  return text.replace(/\s+/g, " ").slice(0, 140);
}

const size = (n: number) => (n < 1000 ? `${n} car.` : `${(n / 1000).toFixed(1).replace(".", ",")} k car.`);

/** One line a call (the latest `LIST_MAX`), those whose tool or subject hold `filter`. */
export function listLines(calls: readonly Call[], filter?: string): string[] {
  const wanted = filter?.toLowerCase();
  const kept = calls.filter(
    (c) => !wanted || c.name.toLowerCase().includes(wanted) || callSubject(c).toLowerCase().includes(wanted),
  );
  const lines = kept
    .slice(-LIST_MAX)
    .map((c) => `#${c.n} ${c.name} · ${callSubject(c)} → ${c.isError ? "erreur, " : ""}${size(c.result.length)}`);
  if (kept.length > LIST_MAX) lines.unshift(`(${kept.length - LIST_MAX} appels plus anciens non listés : filtrer pour les voir)`);
  return lines;
}

/** Call `n` whole: its input and its result, from character `from`, `SHOW_MAX_CHARS` at most. */
export function showCall(calls: readonly Call[], n: number, from = 0): string {
  const call = calls.find((c) => c.n === n);
  if (!call) return `Pas d'appel #${n} (il y en a ${calls.length}).`;
  const whole = `#${call.n} ${call.name}\nEntrée : ${JSON.stringify(call.input, null, 2)}\n\n${call.isError ? "Erreur" : "Sortie"} :\n${call.result}`;
  const part = whole.slice(from, from + SHOW_MAX_CHARS);
  const end = from + part.length;
  return end < whole.length
    ? `${part}\n\n[… ${whole.length - end} caractères de plus : show ${n} ${end}]`
    : part;
}

/** The passages holding `pattern` (case ignored), in the words and the calls' results. */
export function grepLines(entries: readonly Entry[], calls: readonly Call[], pattern: string): string[] {
  const needle = pattern.toLowerCase();
  if (!needle) return [];
  const found: string[] = [];
  const look = (where: string, text: string) => {
    const lower = text.toLowerCase();
    for (let at = lower.indexOf(needle); at >= 0 && found.length < GREP_MAX; at = lower.indexOf(needle, at + needle.length)) {
      const around = text.slice(Math.max(0, at - GREP_AROUND), at + needle.length + GREP_AROUND).replace(/\s+/g, " ");
      found.push(`${where} : …${around}…`);
    }
  };
  for (const s of conversationWords(entries)) look(s.who === "user" ? "Alexis" : s.who === "claude" ? "Claude" : "Résumé", s.text);
  for (const c of calls) look(`#${c.n} ${c.name}`, `${callSubject(c)}\n${c.result}`);
  if (found.length >= GREP_MAX) found.push(`(arrêté à ${GREP_MAX} passages : préciser le motif)`);
  return found;
}

const USAGE = "usage : node transcript.ts list <fichier.jsonl> [filtre] | show <fichier.jsonl> <n> [depuis] | grep <fichier.jsonl> <motif>";

/** The command line's answer. */
export function run(args: readonly string[], read: (path: string) => string): string {
  const [verb, file, arg, from] = args;
  if (!verb || !file) return USAGE;
  const entries = parseEntries(read(file));
  const calls = toolCalls(entries);
  if (verb === "list") return listLines(calls, arg).join("\n") || "Aucun appel.";
  if (verb === "show" && arg) return showCall(calls, Number(arg), Number(from ?? 0) || 0);
  if (verb === "grep" && arg) return grepLines(entries, calls, args.slice(2).join(" ")).join("\n") || "Rien trouvé.";
  return USAGE;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${run(process.argv.slice(2), (path) => readFileSync(path, "utf8"))}\n`);
}
