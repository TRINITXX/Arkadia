import { useCallback, useState } from "react";
import type { ToastFn } from "@/components/modern/MarkdownContent";
import { laterMessages, rewindPointOf } from "@/lib/chat/chatEdit";
import type { ChatDraft } from "@/lib/chat/chatDrafts";
import type { ChatItem } from "@/lib/chat/chatState";
import type { SlashActions } from "@/lib/chat/useSlashActions";

type UserItem = Extract<ChatItem, { kind: "user" }>;

/**
 * The pencil on the user's messages: the conversation goes back to just
 * before one (/rewind, conversation only) and its text waits in the input.
 * Only while Claude rests; asked first when later messages would go.
 */
export function useMessageEdit({
  items,
  actions,
  resting,
  onDraft,
  onToast,
}: {
  items: ChatItem[];
  actions?: SlashActions;
  resting: boolean;
  onDraft: React.Dispatch<React.SetStateAction<ChatDraft>>;
  onToast?: ToastFn;
}) {
  const [pending, setPending] = useState<{
    item: UserItem;
    later: number;
  } | null>(null);
  const [going, setGoing] = useState(false);

  const go = useCallback(
    async (item: UserItem) => {
      if (!actions) return;
      setGoing(true);
      try {
        const point = rewindPointOf(items, item, await actions.rewindPoints());
        // The SDK reads the session from its last compaction on (as `older`).
        if (!point) {
          onToast?.(
            "info",
            "Impossible d'y revenir : ce message précède une compaction",
          );
          return;
        }
        const why = actions.rewind(point, "conversation");
        if (why) onToast?.("info", why);
        else onDraft((d) => ({ ...d, text: point.text }));
      } catch (e) {
        onToast?.("error", e instanceof Error ? e.message : String(e));
      } finally {
        setGoing(false);
        setPending(null);
      }
    },
    [actions, items, onDraft, onToast],
  );

  const onEdit = useCallback(
    (item: UserItem) => {
      const later = laterMessages(items, item);
      if (later > 0) setPending({ item, later });
      else void go(item);
    },
    [items, go],
  );

  return {
    /** Absent while Claude works or without a chat server (preview). */
    onEdit: resting && actions && !going ? onEdit : undefined,
    pending: resting ? pending : null,
    going,
    confirm: () => pending && void go(pending.item),
    cancel: () => setPending(null),
  };
}
