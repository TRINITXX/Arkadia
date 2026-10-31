import type { RewindPoint } from "@/lib/chat/chatProtocol";
import type { ChatItem } from "@/lib/chat/chatState";

type UserItem = Extract<ChatItem, { kind: "user" }>;

/**
 * Why the pencil can't take a message back now, or null: /rewind relaunches
 * the chat, so only Claude at rest (as `chatBusyReason`, whose background
 * tasks `rewind` itself answers at the click). The pencil still shows on
 * hover, dim, with this as its tooltip: absent, it looked missing.
 */
export function editBlocked(chat: {
  working: boolean;
  closed: unknown;
  request: boolean;
  going: boolean;
}): string | null {
  if (chat.closed) return "Conversation arrêtée : reprends-la d'abord";
  if (chat.request) return "Réponds d'abord à la demande de Claude";
  if (chat.working)
    return "Claude travaille : modifiable à la fin de son tour (ou après Échap)";
  if (chat.going) return "Retour en arrière en cours…";
  return null;
}

/** The messages (the user's, Claude's, a peer's) after `item`: what an edit drops. */
export function laterMessages(
  items: readonly ChatItem[],
  item: UserItem,
): number {
  const at = items.findIndex((i) => i.id === item.id);
  if (at < 0) return 0;
  return items
    .slice(at + 1)
    .filter(
      (i) =>
        i.kind === "user" ||
        i.kind === "peer" ||
        i.kind === "text" ||
        i.kind === "command",
    ).length;
}

/**
 * The /rewind point of a message of the column: by its transcript uuid (a
 * past message's id, a sent one's `sent:<uuid>`), else by its text, the
 * same occurrence counted from the end.
 */
export function rewindPointOf(
  items: readonly ChatItem[],
  item: UserItem,
  points: readonly RewindPoint[],
): RewindPoint | null {
  const uuid = item.id.startsWith("sent:") ? item.id.slice(5) : item.id;
  const exact = points.find((p) => p.uuid === uuid);
  if (exact) return exact;
  const text = item.text.trim();
  const at = items.findIndex((i) => i.id === item.id);
  const after = items
    .slice(at + 1)
    .filter((i) => i.kind === "user" && i.text.trim() === text).length;
  const same = points.filter((p) => p.text.trim() === text);
  return same[same.length - 1 - after] ?? null;
}
