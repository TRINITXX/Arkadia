import type { SlashCommandInfo } from "@/lib/chat/chatProtocol";
import {
  commandText,
  isListed,
  menuCommands,
  pageCommand,
  parseSlash,
  slashEntries,
  slashHead,
  TERMINAL_ONLY,
  terminalOnlyNotice,
  type McpAction,
  type McpPending,
  type McpRow,
  type PagePanel,
  type SlashEntry,
} from "@/lib/chat/chatSlash";
import type { RewindMode } from "@/lib/chat/useSlashActions";

/**
 * The phone's `/` menu and its page commands (/resume, /rewind, /mcp), on
 * the desktop's rules (`chatSlash`, `useSlashMenu`) without its keys: a tap
 * stands for Enter, a sheet for the panel above the input. Pure.
 */

/** A row of the phone's `/` menu, with its section's header on its first. */
export interface PhoneSlashRow {
  entry: SlashEntry;
  head: string | null;
}

/**
 * What the menu lists for the composer's text: the desktop's list (the
 * page's commands, then Claude Code's), only while « /name » has no space.
 */
export function phoneSlashMenu(
  text: string,
  commands: SlashCommandInfo[],
  names: string[],
): PhoneSlashRow[] {
  const query = /^\/(\S*)$/.exec(text)?.[1];
  if (query === undefined) return [];
  const entries = slashEntries(menuCommands(commands, names), query);
  return entries.map((entry, i) => ({ entry, head: slashHead(entries, i) }));
}

/** What the page does in place of sending: a panel to open, or a notice. */
export type SlashIntent =
  | { kind: "panel"; panel: PagePanel; query: string }
  | { kind: "notice"; text: string };

/**
 * A message sent: a page command opens its sheet (its words filter the
 * list), a terminal-only built-in Claude Code doesn't list says where it
 * lives. Null: it goes to Claude.
 */
export function slashIntent(
  message: string,
  commands: SlashCommandInfo[],
  names: string[],
): SlashIntent | null {
  const cmd = parseSlash(message);
  if (!cmd) return null;
  const page = pageCommand(cmd.name);
  if (page) return { kind: "panel", panel: page.panel, query: cmd.args };
  if (TERMINAL_ONLY.has(cmd.name) && !isListed(commands, names, cmd.name))
    return { kind: "notice", text: terminalOnlyNotice(cmd.name) };
  return null;
}

/**
 * A menu row tapped: a page command opens its sheet; any other is typed
 * for its arguments, never sent by the tap (a slip would run /clear).
 */
export function slashPick(
  entry: SlashEntry,
): { kind: "panel"; panel: PagePanel } | { kind: "type"; text: string } {
  const page = pageCommand(entry.command.name);
  if (page) return { kind: "panel", panel: page.panel };
  return { kind: "type", text: `/${commandText(entry.command)} ` };
}

/** /rewind's three ways back, Enter's first (`chat-slash-menu.tsx`). */
export const REWIND_CHOICES: { mode: RewindMode; label: string }[] = [
  { mode: "conversation", label: "Revenir ici" },
  { mode: "both", label: "Revenir ici et remettre le code" },
  { mode: "code", label: "Remettre le code seul" },
];

/** /mcp's buttons: a row's main action. */
const MCP_BUTTONS: Partial<Record<McpAction, string>> = {
  connect: "Se connecter",
  reconnect: "Reconnecter",
};

/** What a /mcp row shows, its action under way or not. */
export interface McpRowView {
  /** Its action under way: « … » asked, the sign-in open on the PC. */
  busy: string | null;
  error: string | null;
  /** « Se connecter », « Reconnecter », or none. */
  button: string | null;
  /** The switch: on (connected), off (cut off), none (other states). */
  switchOn: boolean | null;
  /** « connexion en cours » while Claude Code connects it. */
  note: string | null;
}

export function mcpRowView(
  row: McpRow,
  pending: McpPending | undefined,
): McpRowView {
  const busy =
    pending && "state" in pending
      ? pending.state === "signin"
        ? "ouvert sur le PC…"
        : "…"
      : null;
  const error = pending && "error" in pending ? pending.error : row.error;
  return {
    busy,
    error: error ?? null,
    button: (row.action && MCP_BUTTONS[row.action]) ?? null,
    switchOn:
      row.status === "connected"
        ? true
        : row.status === "disabled"
          ? false
          : null,
    note: row.status === "pending" ? "connexion en cours" : null,
  };
}

/**
 * The action a tap asks of a /mcp row (`toggle`: its switch), or null:
 * none, or a question still asked (a sign-in can be asked again).
 */
export function mcpTapAction(
  row: McpRow,
  toggle: boolean,
  pending: McpPending | undefined,
): McpAction | null {
  if (pending && "state" in pending && pending.state === "asking") return null;
  return toggle ? row.toggle : row.action;
}
