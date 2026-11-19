import { Lightbulb } from "lucide-react";
import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { thoughtBody } from "@/lib/chat/chatThoughts";

/**
 * A thought drawn in full, plain, under Claude's last sentence: his latest
 * while he works and no reply follows it yet (« Récit », the user's pick 1
 * of 02/11/2026), which goes behind the next reply's bulb once it comes;
 * and for good, one in his own French words (`thoughtsInFull`, 19/11/2026).
 * Searchable (`data-chat-prose`): an answer left there is read as one.
 */
export function ChatLiveThought({ items }: { items: ThinkingItem[] }) {
  const last = [...items]
    .reverse()
    .map((item) => thoughtBody(item.text))
    .find(Boolean);
  if (!last) return null;
  return (
    <div className="chat-unit chat-live-thought">
      <Lightbulb />
      <p data-chat-prose="">{last}</p>
    </div>
  );
}
