import { bashCommand } from "@/lib/chat/chatBash";
import type { ChatCommand } from "@/lib/chat/chatProtocol";
import {
  pageCommand,
  parseSlash,
  type PagePanel,
  TERMINAL_ONLY,
  terminalOnlyNotice,
} from "@/lib/chat/chatSlash";
import type { PhoneChatCommand } from "@/lib/remoteActions";
import type { ActionButton } from "@/types";

/**
 * A chat from the iPhone: the desktop relays the phone's commands to the
 * chat's server (`chatCommand` action), and the server's answers to a
 * phone's own reads go to that phone alone (`to`, `RemoteHub::chat_line`).
 */

/**
 * A chat's end when its account's server stops; also Rust's answer to a
 * phone's catch-up of such a chat (`chat.rs` `SERVER_GONE`, the same words).
 */
export const SERVER_GONE = "Le serveur du chat s'est arrêté";

/** `to` of what one phone alone gets (`chat-server/server.ts` `emit`). */
export function phoneTarget(client: number): string {
  return `phone:${client}`;
}

/** What the user does from the phone: it drives the tab from then on. */
const DOING = new Set<PhoneChatCommand["type"]>([
  "send",
  "interrupt",
  "answer",
  "set_mode",
  "set_model",
  "set_effort",
  "background",
  "stop_task",
  "cancel_queued",
  "wake",
  "bash",
  "bash_stop",
  "elicit_answer",
]);

/** Asks whose answer is everyone's (the MCP servers' state, its `mcp` event). */
const SHARED = new Set<PhoneChatCommand["type"]>(["mcp_status"]);

/**
 * Reads whose answer only the asking phone needs. `context_detail`: the
 * context ring's sheet (02/11/2026); an older desktop refuses it, and the
 * phone's sheet says the PC needs updating.
 */
const READS = new Set<PhoneChatCommand["type"]>([
  "older",
  "task_output",
  "agent_history",
  "visual_html",
  "context_detail",
]);

/** What the PC alone does, the user's too: a /resume, a /rewind, /mcp… */
const DESKTOP_DOING = new Set<ChatCommand["type"]>([
  "relaunch",
  "restore_code",
  "mcp_action",
  "reload_plugins",
]);

/**
 * Whether the command is the user doing something in the chat: from the
 * phone it makes the phone drive the tab (`paneId`).
 */
export function phoneDrives(type: ChatCommand["type"]): boolean {
  return (DOING as ReadonlySet<string>).has(type);
}

/**
 * Whether the command, sent from the PC, is the user at the PC: a chat the
 * phone drove goes back to the PC (no more rings on the phone).
 */
export function desktopTakesBack(type: ChatCommand["type"]): boolean {
  return phoneDrives(type) || DESKTOP_DOING.has(type);
}

/** What a prompt bar button pressed on the phone does in a chat. */
export type PhonePromptButton =
  | { kind: "send"; text: string }
  | { kind: "bash"; command: string }
  /** Typed in the phone's input, to edit before sending. */
  | { kind: "type"; text: string }
  /** /resume, /rewind, /mcp: the phone's own sheet, filtered by its words. */
  | { kind: "panel"; panel: PagePanel; query: string }
  | { kind: "refuse"; reason: string };

/**
 * The desktop's « Commandes » rules (`runCommand` of `chat-composer.tsx`) for
 * a button the phone pressed: a keyboard shortcut is a terminal's, `!` goes
 * to the shell, what the desktop's input opens itself (/resume, /rewind,
 * /mcp) opens the phone's sheet, and a terminal-only command is not sent,
 * unless
 * Claude Code lists one of that name (a skill: `listed`, as the desktop's
 * `takes`).
 */
export function phonePromptButton(
  button: Pick<ActionButton, "command" | "submit" | "mode">,
  listed: (name: string) => boolean = () => false,
): PhonePromptButton {
  if (button.mode === "keys" || !button.command.trim())
    return {
      kind: "refuse",
      reason: "Raccourci clavier : seulement dans un terminal",
    };
  if (!button.submit) return { kind: "type", text: button.command };
  const command = bashCommand(button.command);
  if (command) return { kind: "bash", command };
  const slash = parseSlash(button.command);
  const page = slash && pageCommand(slash.name);
  if (page) return { kind: "panel", panel: page.panel, query: slash.args };
  if (slash && TERMINAL_ONLY.has(slash.name) && !listed(slash.name))
    return { kind: "refuse", reason: terminalOnlyNotice(slash.name) };
  return { kind: "send", text: button.command };
}

/**
 * The phone's command as the chat's server takes it, or null for one the
 * phone may not send (a start, a close, a page's own report…). A read gets
 * the phone's address: its answer goes to it alone, never to the page. A
 * subagent's conversation is read in the chat's folder, which only the
 * desktop knows (`cwd`).
 */
export function phoneChatCommand(
  chatId: string,
  command: PhoneChatCommand,
  to: string,
  cwd: string,
): ChatCommand | null {
  if (DOING.has(command.type)) return { ...command, chatId } as ChatCommand;
  if (command.type === "agent_history") return { ...command, chatId, to, cwd };
  if (READS.has(command.type)) return { ...command, chatId, to } as ChatCommand;
  if (SHARED.has(command.type)) return { ...command, chatId } as ChatCommand;
  return null;
}
