import type { ChatItem } from "@/lib/chat/chatState";

/**
 * « Copier le dernier bloc de code de Claude » in the chat: the terminal
 * rail's `read_last_code_block` (`conversation.rs`), read from the chat's
 * items instead of the transcript.
 */

/** `[fence char, run length]` when a left-trimmed line opens or closes a fence. */
function fenceMarker(line: string): [string, number] | null {
  const ch = line[0];
  if (ch !== "`" && ch !== "~") return null;
  let len = 0;
  while (line[len] === ch) len++;
  return len >= 3 ? [ch, len] : null;
}

/**
 * The content of the last fenced code block in `text` (fence lines excluded),
 * or null. A closing fence repeats the opener's character at least as many
 * times and carries nothing else; an unclosed fence runs to the end, as
 * CommonMark (and so the column) renders it.
 */
export function lastFencedBlock(text: string): string | null {
  let last: string | null = null;
  let open: [string, number] | null = null;
  let buf: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    const fence = fenceMarker(trimmed);
    if (!open) {
      if (fence) {
        open = fence;
        buf = [];
      }
      continue;
    }
    const [ch, len] = open;
    const closes =
      fence !== null &&
      fence[0] === ch &&
      fence[1] >= len &&
      trimmed.trimEnd() === ch.repeat(trimmed.trimEnd().length);
    if (closes) {
      last = buf.join("\n");
      open = null;
    } else {
      buf.push(line);
    }
  }
  if (open) last = buf.join("\n");
  const code = last?.trimEnd() ?? "";
  return code.trim() ? code : null;
}

/**
 * The last code block of Claude's prose: thinking, tool calls and the user's
 * messages are skipped, and so is a reply still streaming, whose block may be
 * half written (the transcript the rail reads only holds finished ones).
 */
export function lastCodeBlock(items: ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "text" || item.streaming) continue;
    const code = lastFencedBlock(item.text);
    if (code !== null) return code;
  }
  return null;
}
