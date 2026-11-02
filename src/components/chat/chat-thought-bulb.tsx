import { Lightbulb } from "lucide-react";
import { ChatHoverCard } from "@/components/chat/chat-hover-card";
import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { thoughtBody } from "@/lib/chat/chatThoughts";

/** Claude's thinking behind a bulb: the thoughts that led to a reply. */
export function ChatThoughtBulb({ items }: { items: ThinkingItem[] }) {
  // An empty thinking has no body (`thoughtBody`): no bulb for nothing.
  if (!items.some((i) => i.text.trim())) return null;
  return (
    <ChatHoverCard
      icon={<Lightbulb />}
      label="Sa réflexion"
      width={460}
      content={() => (
        <div className="chat-peek-thoughts">
          {items
            .map((i) => thoughtBody(i.text))
            .filter(Boolean)
            .map((body, i) => (
              <p key={i}>{body}</p>
            ))}
        </div>
      )}
    />
  );
}
