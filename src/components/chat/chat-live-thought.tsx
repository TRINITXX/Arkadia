import { Lightbulb } from "lucide-react";
import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { thoughtBody } from "@/lib/chat/chatThoughts";

/**
 * Claude's latest thinking while it works and no reply follows it yet: in
 * full, plain, under its last sentence (« Récit », the user's pick 1 of
 * 02/11/2026). Once a reply comes, it goes behind that reply's bulb.
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
      <p>{last}</p>
    </div>
  );
}
