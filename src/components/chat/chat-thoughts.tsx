import { Brain } from "lucide-react";
import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { thoughtTitle } from "@/lib/chat/chatThoughts";

/**
 * Claude's thinking between two messages on one line, in indigo and
 * italics so it never reads as the grey line of its work below: its
 * summary's title alone, the latest one (the user's ask of 01/11/2026:
 * « juste le résumé »). Several blocks: every title on hover.
 */
export function ChatThoughts({ items }: { items: ThinkingItem[] }) {
  const titles = items.map((i) => thoughtTitle(i.text)).filter(Boolean);
  if (titles.length === 0) return null;
  return (
    <div className="chat-unit chat-thoughts" title={titles.join("\n")}>
      <Brain className="ic" />
      <div className="tx">
        <b>Réflexion · </b>
        {titles[titles.length - 1]}
      </div>
    </div>
  );
}
