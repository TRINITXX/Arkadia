import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useRemoteView } from "~/remote/connection";
import { findTab } from "~/remote/snapshot";
import { TerminalScreen } from "~/terminal/terminal-screen";

/** One tab of the desktop, live. */
export default function TabRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, snapshot } = useRemoteView();
  const found = snapshot ? findTab(snapshot, id) : null;
  if (!snapshot) return <Centered text="Connexion à Arkadia…" />;
  if (!found) return <Centered text="Cet onglet est fermé." />;
  return (
    <TerminalScreen
      snapshot={snapshot}
      project={found.project}
      tab={found.tab}
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
