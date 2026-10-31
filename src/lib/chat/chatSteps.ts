import type { JsonObject } from "@/lib/chat/chatProtocol";
import { toolLabel } from "@/lib/chat/chatGroups";
import type { LivePhase, LiveTool } from "@/lib/chat/chatState";

/**
 * What Claude is doing, in a few words, as the terminal's display mod words
 * it (`~/.claude/mods/outils-discrets`): « lit src/export.ts », « modifie
 * price.ts », « cherche « foo » », a command's own description; and the
 * turn's closing line, « ✻ Terminé en 16 min 02 s · 21:56 · 5 outils ».
 */

const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** A string input's first line, trimmed; "" when absent. */
function line(input: JsonObject, key: string): string {
  const v = input[key];
  return typeof v === "string" ? (v.split("\n")[0] ?? "").trim() : "";
}

/**
 * A file as the mod's tool rows name it: relative to the project inside it,
 * else from the home folder (`~`), else its last two parts past 60 characters.
 */
export function shortPath(path: string, cwd: string | null): string {
  const p = path.replace(/\\/g, "/");
  if (cwd) {
    const root = cwd.replace(/\\/g, "/").replace(/\/?$/, "/");
    if (p.toLowerCase().startsWith(root.toLowerCase()))
      return p.slice(root.length);
  }
  const home = p.replace(/^[A-Za-z]:\/Users\/[^/]+/, "~");
  return home.length > 60 ? `…/${home.split("/").slice(-2).join("/")}` : home;
}

/**
 * One tool call in words (the mod's `stepFor`). A command without a
 * description says what it runs: « lance pnpm test ».
 */
export function toolStep(
  name: string,
  input: JsonObject,
  cwd: string | null,
): string {
  const file = shortPath(
    line(input, "file_path") || line(input, "notebook_path"),
    cwd,
  );
  if (name === "Read") return `lit ${file}`;
  if (EDITS.has(name)) return `modifie ${file}`;
  if (name === "Grep" || name === "Glob")
    return `cherche « ${line(input, "pattern")} »`;
  if (name === "Agent" || name === "Task")
    return `délègue : ${line(input, "description")}`;
  if (
    name === "WebFetch" ||
    name === "WebSearch" ||
    name.startsWith("mcp__exa__")
  )
    return "consulte le web";
  if (name === "Skill") return `lance ${line(input, "skill")}`;
  const description = line(input, "description");
  if (description)
    return description.charAt(0).toLowerCase() + description.slice(1);
  const command = line(input, "command");
  if (command && (name === "Bash" || name === "PowerShell"))
    return `lance ${command}`;
  return toolLabel(name);
}

/**
 * The live line's step: the latest call still running, a subagent's saying
 * so (« agent · lit a.ts »), else what the request is doing (the mod's
 * spinner modes).
 */
export function liveStep(
  tools: LiveTool[],
  phase: LivePhase,
  cwd: string | null,
): string {
  const last = tools[tools.length - 1];
  if (last)
    return `${last.agent ? "agent · " : ""}${toolStep(last.name, last.input, cwd)}`;
  switch (phase) {
    case "thinking":
      return "réfléchit";
    case "responding":
      return "rédige";
    case "tool-input":
      return "prépare un outil";
    case "requesting":
      return "attend le modèle";
    default:
      return "travaille";
  }
}

/** A turn's closing line shows only past this long (the mod's `LONG_TURN_MS`). */
export const LONG_TURN_MS = 10 * 60_000;

export interface TurnDone {
  durationMs: number;
  /** When it ended (ms since epoch). */
  endedAt: number;
  /** The main loop's tool calls. */
  tools: number;
  /** Files it edited, each once. */
  files: number;
}

/** "45 s", "16 min 02 s": the mod's rounding, not the live line's. */
function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/**
 * « ✻ Terminé en 16 min 02 s · 21:56 · 5 outils · 2 fichiers modifiés », the
 * mod's rule: a long turn only, and none while « Messages seuls » is on.
 */
export function turnDoneLine(
  turn: TurnDone,
  messagesOnly: boolean,
): string | null {
  if (turn.durationMs < LONG_TURN_MS || messagesOnly) return null;
  const parts = [
    `✻ Terminé en ${duration(turn.durationMs)}`,
    clock(turn.endedAt),
  ];
  if (turn.tools) parts.push(plural(turn.tools, "outil", "outils"));
  if (turn.files)
    parts.push(plural(turn.files, "fichier modifié", "fichiers modifiés"));
  return parts.join(" · ");
}

/** The words after a folded series' counts: its last call, in progress or not. */
export function lastStep(
  tools: { name: string; input: JsonObject }[],
  cwd: string | null,
): string {
  const last = tools[tools.length - 1];
  return last ? toolStep(last.name, last.input, cwd) : "";
}
