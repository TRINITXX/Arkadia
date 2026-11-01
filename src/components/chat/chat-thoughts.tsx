import { useState } from "react";
import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { thoughtBody } from "@/lib/chat/chatThoughts";

/**
 * Claude's thinking between two messages, in indigo and italics so it never
 * reads as the grey line of its work below: its latest summary alone, two
 * lines at most, the whole of it on a click (the user's pick a + b of
 * 01/11/2026: every block in full was a wall of text).
 */
export function ChatThoughts({ items }: { items: ThinkingItem[] }) {
  const [open, setOpen] = useState(false);
  const last = [...items]
    .reverse()
    .map((item) => thoughtBody(item.text))
    .find(Boolean);
  if (!last) return null;
  return (
    <div
      className={`chat-unit chat-thoughts${open ? " open" : ""}`}
      title={open ? "Réduire" : "Lire toute la réflexion"}
      onClick={() => {
        // A selection drag ends in a click: it selected.
        if (window.getSelection()?.toString()) return;
        setOpen((o) => !o);
      }}
    >
      <p>{last}</p>
    </div>
  );
}
