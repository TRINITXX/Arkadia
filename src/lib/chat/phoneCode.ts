import type { ChatItem } from "@/lib/chat/chatState";

/**
 * The last code block Claude wrote in the chat, for the phone's « Copier le
 * dernier bloc de code » (a terminal's comes from its transcript on the PC,
 * `read_last_code_block`); null when there is none.
 */
export function lastCodeBlock(items: readonly ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "text") continue;
    const blocks = [...item.text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
    const last = blocks[blocks.length - 1]?.[1];
    if (last !== undefined) return last.replace(/\n$/, "");
  }
  return null;
}
