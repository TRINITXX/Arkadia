import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import type { PickerRow } from "@/lib/chat/chatSlash";
import { WELCOME_SESSIONS, welcomeRows } from "@/lib/chat/chatStartup";
import { C, T } from "~/chat/chat-theme";
import { QuietNote } from "~/chat/feed/quiet-note";
import { PickerRowView } from "~/chat/slash/picker-row";
import { ResumeSheet } from "~/chat/slash/resume-sheet";
import { usePanelList } from "~/chat/slash/use-panel-list";
import type { ChatActions } from "~/chat/use-chat";
import { failure, success, tap } from "~/ui/haptics";

/**
 * A new chat's empty column, as the desktop's (`chat-welcome.tsx`, the
 * user's choice of 02/11/2026): the folder's latest sessions, a tap
 * resuming one in this chat on the PC's rules (`chatResume`: Claude at
 * rest, the session free), never a relaunch from the phone. Its search is
 * /resume's sheet, the whole folder. Nothing while the list comes; none in
 * the folder, or no answer: the quiet line.
 */
export function ChatWelcome({
  actions,
  sessionId,
}: {
  actions: ChatActions;
  /** The chat's session: a resumed one known, its row is free again. */
  sessionId: string | null;
}) {
  const list = usePanelList(true, actions.sessions);
  const rows = useMemo(
    () => (list.data ? welcomeRows(list.data, "", list.at) : null),
    [list],
  );
  const [search, setSearch] = useState({ query: "", open: false });
  // « Reprise… » until its past comes in and this column goes; refused, an
  // alert says why. One choice at a time: a second relaunch would stop the
  // first one's.
  const [busy, setBusy] = useState<string | null>(null);
  const picking = useRef(false);
  // The resumed session known with nothing to show: free again.
  useEffect(() => {
    picking.current = false;
    setBusy(null);
  }, [sessionId]);

  const pick = (row: PickerRow) => {
    if (row.disabled || picking.current) return;
    tap();
    picking.current = true;
    setBusy(row.id);
    actions.resume(row.id).then(
      () => success(),
      (e: unknown) => {
        failure();
        picking.current = false;
        setBusy(null);
        Alert.alert(
          "Reprise impossible",
          e instanceof Error ? e.message : String(e),
        );
      },
    );
  };

  if (list.error || (rows && rows.length === 0))
    return <QuietNote text="Pas encore de messages." />;
  if (!rows || !list.data) return null;
  const count = list.data.length;
  return (
    <>
      <ScrollView
        contentContainerStyle={styles.center}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        indicatorStyle="white"
      >
        <View style={styles.card}>
          <View style={styles.head}>
            <SymbolView
              name="clock.arrow.circlepath"
              size={14}
              tintColor={C.accent}
            />
            <Text style={styles.headText}>
              Reprendre une conversation de ce dossier
            </Text>
          </View>
          {rows.map((row) => (
            <PickerRowView
              key={row.id}
              row={row}
              busy={busy === row.id ? "Reprise…" : null}
              onPress={() => pick(row)}
            />
          ))}
          {count > WELCOME_SESSIONS && (
            <Pressable
              onPress={() => {
                tap();
                setSearch({ query: "", open: true });
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.search,
                pressed && styles.pressed,
              ]}
            >
              <SymbolView name="magnifyingglass" size={14} tintColor={C.dim} />
              <Text style={styles.searchText}>
                Rechercher parmi les {count} conversations
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      <ResumeSheet
        visible={search.open}
        query={search.query}
        onQuery={(query) => setSearch((s) => ({ ...s, query }))}
        sessionId={sessionId}
        actions={actions}
        onClose={() => setSearch((s) => ({ ...s, open: false }))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  card: {
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    borderRadius: 14,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  headText: { flex: 1, color: C.dim, fontSize: T.small },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pressed: { backgroundColor: C.raised },
  searchText: { color: C.dim, fontSize: T.small },
});
