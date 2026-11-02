import { useCallback, useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { editBlocked, laterMessages, rewindPointOf } from "@/lib/chat/chatEdit";
import type { ChatItem, ChatState } from "@/lib/chat/chatState";
import {
  EDIT_BEFORE_COMPACTION,
  EDIT_WITH_IMAGES,
} from "@/lib/chat/phoneEdit";
import { foldNextRound } from "~/chat/asks/round-store";
import { putInComposer } from "~/chat/composer-inbox";
import { confirmEdit } from "~/chat/edit-confirm";
import type { ChatActions } from "~/chat/use-chat";
import { showNotice } from "~/ui/notice";

export type UserItem = Extract<ChatItem, { kind: "user" }>;

/**
 * The pencil on the user's messages (the desktop's `useMessageEdit`): the
 * conversation goes back to just before one (/rewind, conversation only)
 * and its text waits in the composer. Only while Claude rests (`blocked`
 * says why not, the pencil stays dim); asked first when later messages
 * would go. A phone has no tooltip: a tap on a blocked pencil says why.
 */
export function useMessageEdit(
  chatId: string,
  state: ChatState,
  actions: ChatActions,
) {
  const [going, setGoing] = useState(false);
  // Read at tap and at confirm time: `onEdit` keeps one identity.
  const stateRef = useRef(state);
  const goingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    stateRef.current = state;
  });
  const why = useCallback(() => {
    const s = stateRef.current;
    return editBlocked({
      working: s.working,
      request: s.requests.length > 0,
      closed: s.closed,
      going: goingRef.current,
    });
  }, []);

  const go = useCallback(
    async (item: UserItem) => {
      goingRef.current = true;
      setGoing(true);
      try {
        const point = rewindPointOf(
          stateRef.current.items,
          item,
          await actions.rewindPoints(),
        );
        // The SDK reads the session from its last compaction on.
        if (!point) return showNotice(EDIT_BEFORE_COMPACTION);
        // Left meanwhile: no rewind whose text would land nowhere.
        if (!mounted.current) return;
        foldNextRound(chatId, stateRef.current);
        await actions.rewind(point.uuid, "conversation");
        putInComposer(chatId, point.text, "message");
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      } catch (e) {
        showNotice(e instanceof Error ? e.message : String(e));
      } finally {
        goingRef.current = false;
        setGoing(false);
      }
    },
    [chatId, actions],
  );

  const onEdit = useCallback(
    (item: UserItem) => {
      const blocked = why();
      if (blocked) return showNotice(blocked);
      // The phone's input takes no image: its pasted ones would be lost.
      if (item.pasted?.length) return showNotice(EDIT_WITH_IMAGES);
      const later = laterMessages(stateRef.current.items, item);
      if (later === 0) return void go(item);
      confirmEdit(later, () => {
        // Claude may have started meanwhile: the desktop's confirm hides then.
        const now = why();
        if (now) showNotice(now);
        else void go(item);
      });
    },
    [go, why],
  );

  return {
    /** No-op with a notice while `blocked`. */
    onEdit,
    /** Why the pencil can't act now (dim), or null. */
    blocked: editBlocked({
      working: state.working,
      request: state.requests.length > 0,
      closed: state.closed,
      going,
    }),
  };
}
