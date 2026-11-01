import { Brain } from "lucide-react";
import type { ThinkingItem } from "@/lib/chat/chatGroups";

/** A summary's bold title (« **Checking the build** ») as its words alone,
 *  its blank lines closed up: a line break each. */
const plain = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\n\s*\n/g, "\n")
    .trim();

/**
 * Claude's thinking between two messages, whole, in indigo and italics so it
 * never reads as the grey line of its work below (the user's pick C of
 * 01/11/2026, « pas replié, je veux les voir entièrement »). Several blocks
 * gather here, one paragraph each.
 */
export function ChatThoughts({ items }: { items: ThinkingItem[] }) {
  const blocks = items
    .map((item) => ({ id: item.id, text: plain(item.text) }))
    .filter((b) => b.text);
  if (blocks.length === 0) return null;
  return (
    <div className="chat-unit chat-thoughts">
      <Brain className="ic" />
      <div className="tx">
        {blocks.map(({ id, text }, i) => (
          <p key={id}>
            {i === 0 && <b>Réflexion · </b>}
            {text}
          </p>
        ))}
      </div>
    </div>
  );
}
