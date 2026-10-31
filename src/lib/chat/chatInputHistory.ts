import type { ChatItem } from "@/lib/chat/chatState";

/**
 * ↑ in the chat's input, as in Claude Code: the user's last messages come
 * back one by one (newest first), ↓ goes the other way, then back to empty.
 * The pane's own conversation is its history.
 */

/** What the user sent in this chat, newest first, without repeats in a row. */
export function sentHistory(items: readonly ChatItem[]): string[] {
  const out: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    let text: string | null = null;
    if (item.kind === "user") text = item.text;
    else if (item.kind === "command")
      text = `/${item.name}${item.args ? ` ${item.args}` : ""}`;
    text = text?.trim() ?? null;
    if (text && out[out.length - 1] !== text) out.push(text);
  }
  return out;
}

/**
 * The next step through the history from `index` (-1: not browsing), or
 * null when there is nowhere to go: ↑ past the oldest stays put, ↓ from the
 * newest comes back to an empty input.
 */
export function recallStep(
  history: readonly string[],
  index: number,
  dir: "up" | "down",
): { index: number; text: string } | null {
  if (dir === "up") {
    if (index + 1 >= history.length) return null;
    return { index: index + 1, text: history[index + 1] };
  }
  if (index < 0) return null;
  if (index === 0) return { index: -1, text: "" };
  return { index: index - 1, text: history[index - 1] };
}
