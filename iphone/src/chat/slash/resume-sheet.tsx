import { useMemo, useRef, useState } from "react";
import { Alert, FlatList } from "react-native";
import { sessionRows, type PickerRow } from "@/lib/chat/chatSlash";
import { PickerRowView } from "~/chat/slash/picker-row";
import { SlashSheet } from "~/chat/slash/slash-sheet";
import { usePanelList } from "~/chat/slash/use-panel-list";
import type { ChatActions } from "~/chat/use-chat";
import { failure, success, tap } from "~/ui/haptics";

/**
 * /resume: the folder's other conversations, newest first (`sessionRows`),
 * this one and those open elsewhere dim. A tap asks the PC to resume it, on
 * its rules (Claude at rest, the session free at that moment); refused, an
 * alert says why and the sheet stays.
 */
export function ResumeSheet({
  visible,
  query,
  onQuery,
  sessionId,
  actions,
  onClose,
}: {
  visible: boolean;
  query: string;
  onQuery: (query: string) => void;
  sessionId: string | null;
  actions: ChatActions;
  onClose: () => void;
}) {
  const list = usePanelList(visible, actions.sessions);
  const rows = useMemo(
    () =>
      list.data ? sessionRows(list.data, query, sessionId, list.at) : null,
    [list, query, sessionId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  // One choice at a time: a second relaunch would stop the first one's.
  const picking = useRef(false);

  const pick = (row: PickerRow) => {
    if (row.disabled || picking.current) return;
    tap();
    picking.current = true;
    setBusy(row.id);
    actions
      .resume(row.id)
      .then(
        () => {
          success();
          onClose();
        },
        (e: unknown) => {
          failure();
          Alert.alert(
            "Reprise impossible",
            e instanceof Error ? e.message : String(e),
          );
        },
      )
      .finally(() => {
        picking.current = false;
        setBusy(null);
      });
  };

  return (
    <SlashSheet
      visible={visible}
      title="Reprendre une conversation"
      icon="clock.arrow.circlepath"
      query={query}
      onQuery={onQuery}
      onClose={onClose}
      notice={
        list.error
          ? { text: list.error, error: true }
          : rows === null
            ? { text: "Chargement…" }
            : rows.length === 0
              ? { text: "Aucune autre conversation dans ce dossier" }
              : null
      }
    >
      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <PickerRowView
            row={item}
            busy={busy === item.id ? "Reprise…" : null}
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
