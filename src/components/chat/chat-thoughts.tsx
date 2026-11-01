import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { thoughtBody } from "@/lib/chat/chatThoughts";

/**
 * Claude's thinking between two messages: its text alone, whole, in indigo
 * and italics so it never reads as the grey line of its work below. No
 * heading line above it (the user's ask of 01/11/2026: « juste ce qui se
 * trouve en dessous, la vraie réflexion »). Several blocks: one paragraph
 * each.
 */
export function ChatThoughts({ items }: { items: ThinkingItem[] }) {
  const blocks = items
    .map((item) => ({ id: item.id, text: thoughtBody(item.text) }))
    .filter((b) => b.text);
  if (blocks.length === 0) return null;
  return (
    <div className="chat-unit chat-thoughts">
      {blocks.map(({ id, text }) => (
        <p key={id}>{text}</p>
      ))}
    </div>
  );
}
