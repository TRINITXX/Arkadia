import type { ChatItem } from "@/lib/chat/chatState";

/**
 * How the column shows the chat's items: consecutive tool calls fold into one
 * line ("4 commandes, 3 fichiers lus"), file changes get their own card, and
 * Claude's bookkeeping (task list, plan file) stays out of sight.
 */

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export type ChatUnit =
  | { kind: "user"; item: Extract<ChatItem, { kind: "user" }> }
  /** Another session's or a subagent's message (`chatPeer`). */
  | { kind: "peer"; item: Extract<ChatItem, { kind: "peer" }> }
  | { kind: "text"; item: Extract<ChatItem, { kind: "text" }> }
  | { kind: "thinking"; item: Extract<ChatItem, { kind: "thinking" }> }
  | { kind: "notice"; item: Extract<ChatItem, { kind: "notice" }> }
  /** A slash command and its answer (`chatCommands`). */
  | { kind: "command"; item: Extract<ChatItem, { kind: "command" }> }
  /** « Terminé en », shown for a long turn only (`turnDoneLine`). */
  | { kind: "turn"; item: Extract<ChatItem, { kind: "turn" }> }
  | { kind: "work"; id: string; tools: ToolItem[] }
  | { kind: "edit"; item: ToolItem }
  | { kind: "agent"; item: ToolItem }
  | { kind: "question"; item: ToolItem }
  | { kind: "plan"; item: ToolItem };

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
 * replies, the messages of other sessions and subagents, the errors, and what answers the user: the commands they typed
 * (cards and notices) and the plan waiting for their answer, which the panel
 * below points to (`pending`: the tool calls a request is about). Thinking,
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
      (u.kind === "notice" && (u.item.tone === "error" || u.item.command)) ||
      (u.kind === "plan" && pending.has(u.item.id)),
  );
}

const CATEGORIES: [RegExp, string, string][] = [
  [/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$/, "commande", "commandes"],
  [/^(Read|NotebookRead)$/, "fichier lu", "fichiers lus"],
  [/^(Grep|Glob|LS|ToolSearch)$/, "recherche", "recherches"],
  [/^(WebFetch|WebSearch)$/, "page web", "pages web"],
  [/^Skill$/, "skill", "skills"],
];

/** "4 commandes, 3 fichiers lus" for a run of tool calls, in first-seen order. */
export function workSummary(tools: ToolItem[]): string {
  const counts = new Map<string, [number, string, string]>();
  for (const tool of tools) {
    const [, one, many] = CATEGORIES.find(([re]) => re.test(tool.name)) ?? [
      null,
      "outil",
      "outils",
    ];
    const entry = counts.get(one) ?? [0, one, many];
    entry[0] += 1;
    counts.set(one, entry);
  }
  return [...counts.values()]
    .map(([n, one, many]) => `${n} ${n > 1 ? many : one}`)
    .join(", ");
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
