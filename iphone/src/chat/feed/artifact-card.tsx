import { Linking, Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { artifactCardTitle } from "@/lib/artifactTitles";
import { C } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";
import { tap } from "~/ui/haptics";
import { showFailure } from "~/ui/notice";

/**
 * A claude.ai artifact link in the chat, as the desktop's card
 * (`chat-artifact-card.tsx`, « un maximum de choses du PC », 02/11/2026):
 * « Artefact · titre » and the open icon. A tap opens it as a link of the
 * chat does, out of the app. Named by the link's words or the artifact's
 * id: the titles the desktop's panel read stay on the PC.
 */
export function ArtifactCard({ href, label }: { href: string; label: string }) {
  const title = artifactCardTitle(href, label, null);
  const open = () => {
    tap();
    Linking.openURL(href).catch(() =>
      showFailure("Impossible d’ouvrir l’artefact."),
    );
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={`Artefact ${title}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <SymbolView name="macwindow" size={15} tintColor={C.accent} />
      <Text style={styles.kind}>Artefact</Text>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <SymbolView name="arrow.up.right.square" size={14} tintColor={C.mute} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 9,
    borderWidth: 1,
    borderColor: F.artifactLine,
    borderRadius: 10,
    backgroundColor: F.artifactBg,
  },
  pressed: { borderColor: F.artifactOnLine, backgroundColor: F.artifactOnBg },
  kind: {
    color: C.accent,
    fontSize: 11.5,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  title: { flexShrink: 1, color: C.ink, fontSize: 13.5 },
});
