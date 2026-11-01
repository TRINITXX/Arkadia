import type { ChatItem } from "@/lib/chat/chatState";

/**
 * The input's `!` commands, as the terminal's bash mode: a message that
 * starts with `!` runs in the tab's folder (`chat-server/bash.ts`) instead of
 * going to Claude, who gets the command and its output with the next one.
 */

type BashItem = Extract<ChatItem, { kind: "bash" }>;

/** The command a message typed as `!command` runs; null: a message for Claude. */
export function bashCommand(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("!")) return null;
  const command = trimmed.slice(1).trim();
  return command || null;
}

/** The server's id of the `!` command still running (Esc stops it first), or null. */
export function runningBash(items: ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "bash" && item.running && item.id.startsWith("bash:"))
      return item.id.slice("bash:".length);
  }
  return null;
}

const count = (n: number) => n.toLocaleString("fr-FR");

/** Said under a card whose output went to Claude cut (`BANG_SENT_MAX`). */
export function bashCutNote(item: BashItem): string | null {
  const { sent, total } = item;
  if (sent === undefined || total === undefined || sent >= total) return null;
  return `Sortie coupée pour Claude : il en reçoit ${count(sent)} caractères sur ${count(total)}.`;
}
