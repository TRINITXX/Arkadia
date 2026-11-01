import { useLayoutEffect, useRef, useState } from "react";
import type { ThinkingItem } from "@/lib/chat/chatGroups";
import { thoughtBody } from "@/lib/chat/chatThoughts";

/**
 * Claude's thinking between two messages, in indigo and italics so it never
 * reads as the grey line of its work below: its latest summary alone, two
 * lines at most, the whole of it on a click when cut (the user's pick a + b
 * of 01/11/2026: every block in full was a wall of text).
 */
export function ChatThoughts({ items }: { items: ThinkingItem[] }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const last = [...items]
    .reverse()
    .map((item) => thoughtBody(item.text))
    .find(Boolean);
  // Cut or not, measured while folded: a text that fits promises no click.
  useLayoutEffect(() => {
    const p = ref.current;
    if (!p || open) return;
    const measure = () => setCut(p.scrollHeight > p.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(p);
    return () => observer.disconnect();
  }, [last, open]);
  if (!last) return null;
  return (
    <div
      className={`chat-unit chat-thoughts${cut ? " cut" : ""}${open ? " open" : ""}`}
      title={cut ? (open ? "Réduire" : "Lire toute la réflexion") : undefined}
      onClick={() => {
        // A selection drag ends in a click: it selected.
        if (!cut || window.getSelection()?.toString()) return;
        setOpen((o) => !o);
      }}
    >
      <p ref={ref}>{last}</p>
    </div>
  );
}
