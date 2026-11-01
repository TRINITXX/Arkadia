import type { ChatItem } from "@/lib/chat/chatState";
import { isVisualTool } from "@/lib/chat/chatVisual";

/**
 * How the column shows the chat's items: consecutive tool calls fold into one
 * line ("4 commandes, 3 fichiers lus"), file changes get their own card, and
 * Claude's bookkeeping (task list, plan file) stays out of sight.
 */

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export type ThinkingItem = Extract<ChatItem, { kind: "thinking" }>;

/** Claude's work between two messages, folded into one line (`foldActivity`). */
export type FoldedUnit =
  | { kind: "work"; id: string; tools: ToolItem[] }
  | { kind: "edit"; item: ToolItem }
  | { kind: "agent"; item: ToolItem };

export type ChatUnit =
  | FoldedUnit
  | { kind: "thinking"; item: ThinkingItem }
  /** Claude's work between two messages: its counts on one line. */
  | { kind: "activity"; id: string; units: FoldedUnit[] }
  /** Claude's thinking between two messages, whole, above its work. */
  | { kind: "thoughts"; id: string; items: ThinkingItem[] }
  | { kind: "user"; item: Extract<ChatItem, { kind: "user" }> }
  /** Another session's or a subagent's message (`chatPeer`). */
  | { kind: "peer"; item: Extract<ChatItem, { kind: "peer" }> }
  | { kind: "text"; item: Extract<ChatItem, { kind: "text" }> }
  | { kind: "notice"; item: Extract<ChatItem, { kind: "notice" }> }
  /** A slash command and its answer (`chatCommands`). */
  | { kind: "command"; item: Extract<ChatItem, { kind: "command" }> }
  /** A `!` command of the user and its output. */
  | { kind: "bash"; item: Extract<ChatItem, { kind: "bash" }> }
  /** « Terminé en », shown for a long turn only (`turnDoneLine`). */
  | { kind: "turn"; item: Extract<ChatItem, { kind: "turn" }> }
  | { kind: "question"; item: ToolItem }
  | { kind: "plan"; item: ToolItem }
  /** Claude's HTML page (`show_visual`), as a card where it was called. */
  | { kind: "visual"; item: ToolItem };

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
/** Shown elsewhere: the task list (live line) and the session's own files. */
const HIDDEN_TOOLS = new Set([
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
]);

/** Claude Code's plan file, written just before ExitPlanMode. */
export function isPlanFile(item: ToolItem): boolean {
  const path = item.input.file_path;
  return typeof path === "string" && /[\\/]plans[\\/][^\\/]+\.md$/i.test(path);
}

export function groupChatItems(items: ChatItem[]): ChatUnit[] {
  const units: ChatUnit[] = [];
  let work: ToolItem[] = [];
  const flush = () => {
    if (work.length > 0)
      units.push({ kind: "work", id: work[0].id, tools: work });
    work = [];
  };
  for (const item of items) {
    if (item.kind !== "tool") {
      // An empty thinking block (summaries off) shows nothing and doesn't
      // break a run of tool calls.
      if (item.kind === "thinking" && !item.text.trim()) continue;
      flush();
      units.push({ kind: item.kind, item } as ChatUnit);
      continue;
    }
    if (HIDDEN_TOOLS.has(item.name)) continue;
    if (EDIT_TOOLS.has(item.name)) {
      if (isPlanFile(item)) continue;
      flush();
      units.push({ kind: "edit", item });
    } else if (item.name === "Agent" || item.name === "Task") {
      flush();
      units.push({ kind: "agent", item });
    } else if (item.name === "AskUserQuestion") {
      flush();
      units.push({ kind: "question", item });
    } else if (item.name === "ExitPlanMode") {
      flush();
      units.push({ kind: "plan", item });
    } else if (isVisualTool(item.name)) {
      flush();
      units.push({ kind: "visual", item });
    } else {
      work = [...work, item];
    }
  }
  flush();
  return units;
}

const NONE = new Set<string>();

/**
 * « Messages seuls » (the terminal rail's button): the user's words, Claude's
 * replies, the messages of other sessions and subagents, the errors, and what answers the user: the commands they typed (`/` and `!`)
 * (cards and notices) and the plan waiting for their answer, which the panel
 * below points to (`pending`: the tool calls a request is about), and
 * Claude's visuals, but not one found broken (a fixed one follows). Thinking,
 * tool work, edits, subagents, question recaps, decided plans, other info
 * notices and « Terminé en » drop out.
 */
export function messagesOnly(
  units: ChatUnit[],
  pending: Set<string> = NONE,
): ChatUnit[] {
  return units.filter(
    (u) =>
      u.kind === "user" ||
      u.kind === "peer" ||
      u.kind === "text" ||
      u.kind === "command" ||
      u.kind === "bash" ||
      (u.kind === "notice" && (u.item.tone === "error" || u.item.command)) ||
      (u.kind === "plan" && pending.has(u.item.id)) ||
      (u.kind === "visual" && !u.item.result?.isError),
  );
}

/** What Claude's work counts, in the order an activity line shows it. */
export type ActivityKind =
  | "command"
  | "read"
  | "search"
  | "web"
  | "skill"
  | "tool"
  | "edit"
  | "agent";

const ACTIVITY_LABELS: Record<ActivityKind, [string, string]> = {
  command: ["commande", "commandes"],
  read: ["fichier lu", "fichiers lus"],
  search: ["recherche", "recherches"],
  web: ["page web", "pages web"],
  skill: ["skill", "skills"],
  tool: ["outil", "outils"],
  edit: ["fichier modifié", "fichiers modifiés"],
  agent: ["sous-agent", "sous-agents"],
};
const KIND_ORDER = Object.keys(ACTIVITY_LABELS) as ActivityKind[];

const CATEGORIES: [RegExp, ActivityKind][] = [
  [/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$/, "command"],
  [/^(Read|NotebookRead)$/, "read"],
  [/^(Grep|Glob|LS|ToolSearch)$/, "search"],
  // Exa's search and fetch: the web too.
  [/^(WebFetch|WebSearch|mcp__exa__.+)$/, "web"],
  [/^Skill$/, "skill"],
];

const toolKind = (name: string): ActivityKind =>
  CATEGORIES.find(([re]) => re.test(name))?.[1] ?? "tool";

/** « 4 commandes », « 1 fichier modifié ». */
const countLabel = (kind: ActivityKind, n: number) =>
  `${n} ${ACTIVITY_LABELS[kind][n > 1 ? 1 : 0]}`;

/** A call without its result still runs, unless read from the past (`stale`). */
export function toolRunning(tool: ToolItem): boolean {
  return !tool.result && !tool.stale;
}

/** "4 commandes, 3 fichiers lus" for a run of tool calls, in first-seen order. */
export function workSummary(tools: ToolItem[]): string {
  const counts = new Map<ActivityKind, number>();
  for (const tool of tools) {
    const kind = toolKind(tool.name);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => countLabel(kind, n)).join(", ");
}

const folds = (u: ChatUnit): u is FoldedUnit =>
  u.kind === "work" || u.kind === "edit" || u.kind === "agent";

const foldedId = (u: FoldedUnit) => (u.kind === "work" ? u.id : u.item.id);

/**
 * Claude's work between two messages (tool lines, file changes, subagents)
 * as one line each time (the user's ask of 01/11/2026: « condensé en un truc
 * à chaque fois »); a click unfolds it as it was. Its thinking there, whole
 * and apart, just above (the user's pick C, unfolded, of 01/11/2026).
 * Messages, visuals, questions, plans, notices and commands stay as they are.
 */
export function foldActivity(units: ChatUnit[]): ChatUnit[] {
  const out: ChatUnit[] = [];
  let thoughts: ThinkingItem[] = [];
  let run: FoldedUnit[] = [];
  const flush = () => {
    if (thoughts.length > 0)
      out.push({
        kind: "thoughts",
        id: `thoughts:${thoughts[0].id}`,
        items: thoughts,
      });
    if (run.length > 0)
      out.push({
        kind: "activity",
        id: `activity:${foldedId(run[0])}`,
        units: run,
      });
    thoughts = [];
    run = [];
  };
  for (const unit of units) {
    if (unit.kind === "thinking") thoughts.push(unit.item);
    else if (folds(unit)) run.push(unit);
    else {
      flush();
      out.push(unit);
    }
  }
  flush();
  return out;
}

/** The tool calls of an activity line, in order. */
export function activityTools(units: FoldedUnit[]): ToolItem[] {
  return units.flatMap((u) => (u.kind === "work" ? u.tools : [u.item]));
}

export interface ActivityCount {
  kind: ActivityKind;
  n: number;
  /** « 4 commandes », for its tooltip. */
  label: string;
}

/**
 * An activity line's counts by kind, always in the same order (the user's
 * pick B of 01/11/2026: an icon and a number each); a file changed several
 * times counts once.
 */
export function activityCounts(units: FoldedUnit[]): ActivityCount[] {
  const counts = new Map<ActivityKind, number>();
  const add = (kind: ActivityKind) =>
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const edited = new Set<string>();
  for (const unit of units) {
    if (unit.kind === "agent") add("agent");
    else if (unit.kind === "edit") {
      const path = unit.item.input.file_path ?? unit.item.input.notebook_path;
      const key =
        typeof path === "string"
          ? path.replace(/\\/g, "/").toLowerCase()
          : unit.item.id;
      if (edited.has(key)) continue;
      edited.add(key);
      add("edit");
    } else for (const tool of unit.tools) add(toolKind(tool.name));
  }
  return KIND_ORDER.flatMap((kind) => {
    const n = counts.get(kind);
    return n ? [{ kind, n, label: countLabel(kind, n) }] : [];
  });
}

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** The one detail that names a tool call: its command, file, pattern or URL. */
export function toolSummary(tool: ToolItem): string {
  const input = tool.input;
  const s = (k: string) =>
    typeof input[k] === "string" ? (input[k] as string) : "";
  switch (tool.name) {
    case "Bash":
    case "PowerShell":
      return s("description") || s("command").split("\n")[0];
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return basename(s("file_path") || s("notebook_path"));
    case "Grep":
    case "Glob":
      return s("pattern");
    case "WebFetch":
      return s("url");
    case "WebSearch":
      return s("query");
    case "Agent":
    case "Task":
      return s("description");
    case "Skill":
      return s("skill");
    default: {
      const first = Object.values(input).find((v) => typeof v === "string");
      return typeof first === "string" ? first.split("\n")[0] : "";
    }
  }
}

/** A tool name as read: MCP tools lose their `mcp__server__` prefix. */
export function toolLabel(name: string): string {
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  return mcp ? `${mcp[2]} (${mcp[1]})` : name;
}

/** The answers of a finished AskUserQuestion, from its result text. */
export function questionAnswers(tool: ToolItem): [string, string][] {
  const text = tool.result?.text ?? "";
  return [...text.matchAll(/"([^"]+)"="([^"]*)"/g)].map((m) => [m[1], m[2]]);
}
