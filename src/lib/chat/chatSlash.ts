import type {
  McpServerInfo,
  RewindPoint,
  SessionChoice,
  SlashCommandInfo,
} from "@/lib/chat/chatProtocol";
import { mcpName } from "@/lib/chat/chatSdkSettings";

/**
 * The chat's `/` commands: Claude Code's own list (`supportedCommands`), the
 * commands the page runs itself (`PAGE_COMMANDS`), and the terminal-only
 * built-ins the page answers in French instead of sending them. Pure: the
 * menu (`useSlashMenu`) and the reducer (`chatState`) read it.
 */

export type SlashGroup = "builtin" | "user" | "plugin";

export const SLASH_GROUPS: SlashGroup[] = ["builtin", "user", "plugin"];

export const SLASH_GROUP_LABELS: Record<SlashGroup, string> = {
  builtin: "Claude Code",
  user: "Tes skills et commandes",
  plugin: "Plugins et MCP",
};

/** The page's own commands: each opens its panel above the input. */
export type PagePanel = "resume" | "rewind" | "mcp";

export interface PageCommand extends SlashCommandInfo {
  panel: PagePanel;
}

export const PAGE_COMMANDS: PageCommand[] = [
  {
    name: "resume",
    description: "Reprendre une autre conversation de ce dossier",
    argumentHint: "[recherche]",
    builtin: true,
    panel: "resume",
  },
  {
    name: "rewind",
    description: "Revenir avant un de tes messages, le code aussi si tu veux",
    argumentHint: "[recherche]",
    builtin: true,
    panel: "rewind",
  },
  {
    name: "mcp",
    description: "Connecter, reconnecter ou couper tes serveurs MCP",
    argumentHint: "[recherche]",
    builtin: true,
    panel: "mcp",
  },
];

export function pageCommand(name: string): PageCommand | undefined {
  return PAGE_COMMANDS.find((c) => c.name === name);
}

/**
 * Built-ins a headless Claude Code refuses ("isn't available in this
 * environment"): the page says where they live instead of sending them.
 * Any other refusal is caught on its answer (`refusedCommand`).
 */
export const TERMINAL_ONLY = new Set([
  "add-dir",
  "btw",
  "copy",
  "exit",
  "export",
  "help",
  "hooks",
  "login",
  "logout",
  "memory",
  "permissions",
  "plan",
  "quit",
  "status",
  "tasks",
  "voice",
]);

export function terminalOnlyNotice(name: string): string {
  return `/${name} n'existe que dans le terminal : bouton Terminal en haut à droite`;
}

/** The command a headless Claude Code refused, from its answer, or null. */
export function refusedCommand(output: string): string | null {
  const m =
    /^\/(\S+) (?:opens an interactive panel and )?isn't available in this environment\./.exec(
      output.trim(),
    );
  return m ? m[1] : null;
}

/** `/name args` (a path such as `/tmp/x` is no command), or null. */
export function parseSlash(
  text: string,
): { name: string; args: string } | null {
  const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { name: m[1], args: (m[2] ?? "").trim() } : null;
}

/** Whether `name` (or an alias) is a command Claude Code listed. */
export function isListed(
  commands: SlashCommandInfo[],
  names: string[],
  name: string,
): boolean {
  return (
    names.includes(name) ||
    commands.some((c) => c.name === name || c.aliases?.includes(name))
  );
}

export function slashGroup(command: SlashCommandInfo): SlashGroup {
  if (command.builtin) return "builtin";
  return command.name.includes(":") ? "plugin" : "user";
}

/** Required arguments: Enter completes the command instead of running it. */
export function needsArgs(hint: string): boolean {
  const h = hint.trim();
  return h !== "" && !h.startsWith("[") && !/optional/i.test(h);
}

/** What to type to run it: MCP prompts are listed as `server:prompt (MCP)`. */
export function commandText(command: SlashCommandInfo): string {
  return command.name.replace(/ \(MCP\)$/, "");
}

/**
 * What the menu lists: the page's commands, then Claude Code's (its names
 * alone until its full list comes), internals (`__x`) left out, a name the
 * page runs itself listed once.
 */
export function menuCommands(
  listed: SlashCommandInfo[],
  names: string[],
): SlashCommandInfo[] {
  const base: SlashCommandInfo[] =
    listed.length > 0
      ? listed
      : names.map((name) => ({ name, description: "", argumentHint: "" }));
  return [
    ...PAGE_COMMANDS,
    ...base.filter((c) => !c.name.startsWith("_") && !pageCommand(c.name)),
  ];
}

/**
 * 0 exact, 1 prefix, 2 a word's prefix (`superpowers:brainstorming`), 3
 * inside a word, from 3 letters on (`re` would match half the list); -1 none.
 */
function rank(command: SlashCommandInfo, query: string): number {
  const names = [command.name, ...(command.aliases ?? [])].map((n) =>
    n.toLowerCase(),
  );
  if (names.includes(query)) return 0;
  if (names.some((n) => n.startsWith(query))) return 1;
  if (names.some((n) => n.split(/[:\-_ ]/).some((w) => w.startsWith(query))))
    return 2;
  return query.length >= 3 && names.some((n) => n.includes(query)) ? 3 : -1;
}

export interface SlashEntry {
  command: SlashCommandInfo;
  group: SlashGroup;
  /** Its name typed in full: pinned first, out of its group (`slashHead`). */
  exact?: boolean;
}

/**
 * The menu for what follows the `/`: the name typed in full first, whatever
 * its group (Enter runs the first row: `/m` must not run `/mcp`), then
 * built-ins, the user's skills and commands, plugins; in a group, the
 * closest names first.
 */
export function slashEntries(
  commands: SlashCommandInfo[],
  query: string,
): SlashEntry[] {
  const q = query.toLowerCase();
  const scored: { command: SlashCommandInfo; group: SlashGroup; r: number }[] =
    [];
  for (const command of commands) {
    const r = q ? rank(command, q) : 1;
    if (r >= 0) scored.push({ command, group: slashGroup(command), r });
  }
  const exact = (x: { r: number }) => (x.r === 0 ? 0 : 1);
  scored.sort(
    (a, b) =>
      exact(a) - exact(b) ||
      SLASH_GROUPS.indexOf(a.group) - SLASH_GROUPS.indexOf(b.group) ||
      a.r - b.r ||
      a.command.name.localeCompare(b.command.name),
  );
  return scored.map(({ command, group, r }) =>
    q && r === 0 ? { command, group, exact: true } : { command, group },
  );
}

/**
 * The header above row `i`, or null: where its section starts. The exact
 * match pinned first has its own, so its group's header never shows twice.
 */
export function slashHead(entries: SlashEntry[], i: number): string | null {
  const section = (e: SlashEntry) => (e.exact ? "exact" : e.group);
  if (i > 0 && section(entries[i - 1]) === section(entries[i])) return null;
  return entries[i].exact
    ? "Correspondance exacte"
    : SLASH_GROUP_LABELS[entries[i].group];
}

/** A row of a page command's panel. */
export interface PickerRow {
  id: string;
  title: string;
  meta: string;
  /** Why it can't be chosen (« en cours »), shown as a tag. */
  disabled?: string;
}

const time = (d: Date) =>
  d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const dayStart = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** « 14:32 », « hier 14:32 », « lun. 14:32 », « 12 oct. », « 12 oct. 2025 ». */
export function whenLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const days = Math.round((dayStart(new Date(now)) - dayStart(d)) / 86_400_000);
  if (days <= 0) return time(d);
  if (days === 1) return `hier ${time(d)}`;
  if (days < 7)
    return `${d.toLocaleDateString("fr-FR", { weekday: "short" })} ${time(d)}`;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

/** Lower case, accents gone: « reponse » finds « Réponse ». */
const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Every word of the query in one of the texts, accents aside. */
const matches = (query: string, ...texts: (string | undefined)[]) => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = texts.map((t) => fold(t ?? ""));
  return words.every((w) => hay.some((t) => t.includes(w)));
};

/**
 * The server's list with the sessions a Claude Code runs in another pane of
 * Arkadia (`liveSessions`): never two on one session.
 */
export function markLive(
  sessions: SessionChoice[],
  live: ReadonlySet<string>,
): SessionChoice[] {
  return sessions.map((s) =>
    !s.open && live.has(s.sessionId) ? { ...s, open: true } : s,
  );
}

export const OPEN_ELSEWHERE =
  "Cette conversation est ouverte dans un autre volet : va dans son onglet";

/**
 * Why a session can't be resumed now, from lists read at the moment of the
 * choice (the panel's may be stale): it runs in another pane. Null if free.
 */
export function resumeRefusal(
  sessions: SessionChoice[],
  live: ReadonlySet<string>,
  sessionId: string,
): string | null {
  const held =
    live.has(sessionId) ||
    sessions.some((s) => s.sessionId === sessionId && s.open);
  return held ? OPEN_ELSEWHERE : null;
}

/** A transcript's size in megabytes, French: « 0,4 Mo », « 12,4 Mo », « 153 Mo ». */
export function sizeLabel(bytes: number | undefined): string | null {
  if (bytes === undefined) return null;
  const mb = bytes / 1_000_000;
  const shown =
    mb >= 10
      ? String(Math.round(mb))
      : Math.max(mb, 0.1).toFixed(1).replace(".", ",");
  return `${shown} Mo`;
}

/**
 * /resume: the folder's sessions, newest first; this one and those open
 * elsewhere can't be taken. Their date and size, never the git branch
 * (Alexis, 03/11/2026: he always works on the same one).
 */
export function sessionRows(
  sessions: SessionChoice[],
  query: string,
  current: string | null,
  now: number,
): PickerRow[] {
  return sessions
    .filter((s) => matches(query, s.title, s.sessionId))
    .sort((a, b) => b.lastModified - a.lastModified)
    .map((s) => ({
      id: s.sessionId,
      title: s.title || "Sans titre",
      meta: [whenLabel(s.lastModified, now), sizeLabel(s.size)]
        .filter(Boolean)
        .join(" · "),
      disabled:
        s.sessionId === current
          ? "en cours"
          : s.open
            ? "ouverte ailleurs"
            : undefined,
    }));
}

/** /rewind: the user's messages, newest first, by their first line. */
export function rewindRows(
  points: RewindPoint[],
  query: string,
  now: number,
): PickerRow[] {
  return points
    .filter((p) => matches(query, p.text))
    .map((p) => ({
      id: p.uuid,
      title: p.text.trim().split("\n")[0],
      meta: p.timestamp ? whenLabel(Date.parse(p.timestamp), now) : "",
    }))
    .reverse();
}

/** What a click or Enter does on an MCP server's row. */
export type McpAction = "connect" | "reconnect" | "enable" | "disable";

/** A row of /mcp: a server, its group, its action. */
export interface McpRow extends PickerRow {
  status: string;
  /** Where it is set: « perso », « projet », « plugin », « claude.ai »… */
  source: string;
  /** Its section's title, on its first row only. */
  head?: string;
  /** Enter's action; Ctrl+Enter's is `toggle`. */
  action: McpAction | null;
  toggle: McpAction | null;
  error?: string;
}

/** /mcp's sections, in order: what needs the user first (the user's pick A of 01/11/2026). */
const MCP_GROUPS: [string, (s: McpServerInfo) => boolean][] = [
  ["En échec", (s) => s.status === "failed"],
  ["À connecter", (s) => s.status === "needs-auth"],
  ["Connexion en cours", (s) => s.status === "pending"],
  ["Connectés", (s) => s.status === "connected"],
  ["Coupés", (s) => s.status === "disabled"],
];

const MCP_SOURCES: Record<string, string> = {
  user: "perso",
  project: "projet",
  local: "ce dossier",
  plugin: "plugin",
  claudeai: "claude.ai",
  dynamic: "Arkadia",
  managed: "géré",
  enterprise: "géré",
};

/** « Gmail » for `claude.ai Gmail`: its source says where it comes from. */
const shortName = (s: McpServerInfo) =>
  s.source === "claudeai"
    ? s.name.replace(/^claude\.ai /, "")
    : mcpName(s.name);

/**
 * /mcp: the servers by section (failed, to connect, connecting, connected,
 * cut off), the user's own before claude.ai's connectors in each, then by
 * name. Enter connects, reconnects or switches back on; Ctrl+Enter cuts off
 * or switches on. The servers of the Lab itself (`sdk`) aren't listed.
 */
export function mcpRows(servers: McpServerInfo[], query: string): McpRow[] {
  const rows: McpRow[] = [];
  const shown = servers.filter(
    (s) =>
      s.source !== "sdk" &&
      matches(query, shortName(s), s.name, MCP_SOURCES[s.source ?? ""]),
  );
  const order = (a: McpServerInfo, b: McpServerInfo) =>
    Number(a.source === "claudeai") - Number(b.source === "claudeai") ||
    shortName(a).localeCompare(shortName(b));
  for (const [head, inGroup] of MCP_GROUPS) {
    const group = shown.filter(inGroup).sort(order);
    group.forEach((s, i) =>
      rows.push({
        id: s.name,
        title: shortName(s),
        meta: "",
        status: s.status,
        source: MCP_SOURCES[s.source ?? ""] ?? s.source ?? "",
        head: i === 0 ? `${head} · ${group.length}` : undefined,
        action:
          s.status === "needs-auth"
            ? "connect"
            : s.status === "failed"
              ? "reconnect"
              : s.status === "disabled"
                ? "enable"
                : null,
        toggle:
          s.status === "disabled"
            ? "enable"
            : s.status === "pending"
              ? null
              : "disable",
        error: s.error,
      }),
    );
  }
  return rows;
}

/**
 * A /mcp row's action under way, with the server's state when it began:
 * asked, its sign-in open in the browser, or why it failed.
 */
export type McpPending =
  | { state: "asking"; status: string }
  | { state: "signin"; status: string }
  | { error: string; status: string };

/**
 * The actions under way once the servers' states come: a sign-in or an
 * error is over as soon as its server's state changed (connected, failed,
 * cut off: the row says it). A question asked waits for its answer.
 */
export function settleMcpPending(
  all: Record<string, McpPending>,
  servers: McpServerInfo[],
): Record<string, McpPending> {
  const over = Object.keys(all).filter((name) => {
    const p = all[name];
    if ("state" in p && p.state === "asking") return false;
    return servers.find((s) => s.name === name)?.status !== p.status;
  });
  if (over.length === 0) return all;
  const next = { ...all };
  for (const name of over) delete next[name];
  return next;
}
