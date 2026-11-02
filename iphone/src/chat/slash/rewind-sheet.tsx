import { useMemo, useRef, useState } from "react";
import { ActionSheetIOS, Alert, FlatList } from "react-native";
import * as Haptics from "expo-haptics";
import type { RewindPoint } from "@/lib/chat/chatProtocol";
import { rewindRows, type PickerRow } from "@/lib/chat/chatSlash";
import { REWIND_CHOICES } from "@/lib/chat/phoneSlash";
import type { RewindMode } from "@/lib/chat/useSlashActions";
import { PickerRowView } from "~/chat/slash/picker-row";
import { SlashSheet } from "~/chat/slash/slash-sheet";
import { usePanelList } from "~/chat/slash/use-panel-list";
import type { ChatActions } from "~/chat/use-chat";

/**
 * /rewind: the user's messages, newest first (`rewindRows`). A tap asks how
 * far back, as the desktop's Enter / Ctrl+Entrée / Alt+Entrée: the
 * conversation, with the code, or the code alone. Back before a message,
 * its text waits in the composer (`onRewound`), as in the terminal.
 */
export function RewindSheet({
  visible,
  query,
  onQuery,
  actions,
  onClose,
  onRewinding,
  onRewound,
}: {
  visible: boolean;
  query: string;
  onQuery: (query: string) => void;
  actions: ChatActions;
  onClose: () => void;
  /** A conversation rewind about to go (`foldNextRound`). */
  onRewinding: () => void;
  /** The conversation went back: the message's text, for the composer. */
  onRewound: (text: string) => void;
}) {
  const list = usePanelList(visible, actions.rewindPoints);
  const rows = useMemo(
    () => (list.data ? rewindRows(list.data, query, list.at) : null),
    [list, query],
  );
  const [busy, setBusy] = useState<string | null>(null);
  // One choice at a time: a second relaunch would stop the first one's.
  const picking = useRef(false);

  const go = (point: RewindPoint, mode: RewindMode) => {
    if (picking.current) return;
    picking.current = true;
    setBusy(point.uuid);
    if (mode !== "code") onRewinding();
    actions
      .rewind(point.uuid, mode)
      .then(
        () => {
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );
          // The code alone: the conversation goes on, nothing to retype.
          if (mode !== "code") onRewound(point.text);
          onClose();
        },
        (e: unknown) =>
          Alert.alert(
            "Retour impossible",
            e instanceof Error ? e.message : String(e),
          ),
      )
      .finally(() => {
        picking.current = false;
        setBusy(null);
      });
  };

  const pick = (row: PickerRow) => {
    const point = list.data?.find((p) => p.uuid === row.id);
    if (!point || picking.current) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Revenir avant ce message",
        message: row.title,
        options: [...REWIND_CHOICES.map((c) => c.label), "Annuler"],
        cancelButtonIndex: REWIND_CHOICES.length,
        userInterfaceStyle: "dark",
      },
      (i) => {
        const choice = REWIND_CHOICES[i];
        if (choice) go(point, choice.mode);
      },
    );
  };

  return (
    <SlashSheet
      visible={visible}
      title="Revenir avant un message"
      icon="arrow.uturn.backward"
      query={query}
      onQuery={onQuery}
      onClose={onClose}
      notice={
        list.error
          ? { text: list.error, error: true }
          : rows === null
            ? { text: "Chargement…" }
            : rows.length === 0
              ? { text: "Aucun message à reprendre" }
              : null
      }
    >
      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <PickerRowView
            row={item}
            busy={busy === item.id ? "Retour…" : null}
            onPress={() => pick(item)}
          />
        )}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        indicatorStyle="white"
      />
    </SlashSheet>
  );
}
