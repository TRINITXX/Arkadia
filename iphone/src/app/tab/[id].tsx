import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { ChatScreen } from "~/chat/chat-screen";
import { useRemoteView } from "~/remote/connection";
import { findTab } from "~/remote/snapshot";
import { TerminalScreen } from "~/terminal/terminal-screen";

/**
 * One tab of the desktop, live: its chat, or its terminal. The pane shown is
 * the route's (`pane`), the one place it is chosen: « Volets » set it, and a
 * tab opened without one pins the desktop's active pane, so a click on the PC
 * never moves the phone to another pane.
 */
export default function TabRoute() {
  const { id, pane } = useLocalSearchParams<{ id: string; pane?: string }>();
  const { status, snapshot } = useRemoteView();
  const found = snapshot ? findTab(snapshot, id) : null;
  // A pane closed on the desktop: the tab's active one.
  const shown = found
    ? (found.tab.panes.find((p) => p.id === pane) ??
      found.tab.panes.find((p) => p.id === found.tab.activePaneId) ??
      found.tab.panes[0])
    : undefined;
  const shownId = shown?.id;
  // This screen's own params, even with another screen above it (`/pick`, a
  // tab a notification opened): `router.setParams` would write the top one's.
  const navigation = useNavigation<{
    setParams(params: { pane: string }): void;
  }>();
  useEffect(() => {
    if (shownId && shownId !== pane) navigation.setParams({ pane: shownId });
  }, [shownId, pane, navigation]);

  if (!snapshot) return <Centered text="Connexion à Arkadia…" />;
  if (!found || !shown) return <Centered text="Cet onglet est fermé." />;
  // Keyed: another chat, or a switch to the terminal (or back), mounts anew.
  if (shown.chat)
    return (
      <ChatScreen
        key={shown.id}
        snapshot={snapshot}
        project={found.project}
        tab={found.tab}
        pane={shown}
        status={status}
      />
    );
  return (
    <TerminalScreen
      key="terminal"
      snapshot={snapshot}
      project={found.project}
      tab={found.tab}
      pane={shown}
      status={status}
    />
  );
}

function Centered({ text }: { text: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { color: "#8e8e93", fontSize: 15 },
});
