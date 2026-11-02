import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { C, T } from "~/chat/chat-theme";
import { tap } from "~/ui/haptics";

/** A page that never comes (the server's error is in the feed) frees the button. */
const LOADING_MS = 15_000;

/**
 * The top of a resumed chat whose past goes further back
 * (`chat-older-button.tsx`): « Charger les messages plus anciens » brings the
 * page before. The inverted list keeps the reader where they were: rows
 * come above. Without a cursor, the old hint.
 */
export function OlderButton({
  cursor,
  onLoad,
}: {
  /** The oldest shown: it changes once the page is in. */
  cursor: string | null;
  onLoad: () => void;
}) {
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  useEffect(() => {
    if (loadingFor === null) return;
    const timer = setTimeout(() => setLoadingFor(null), LOADING_MS);
    return () => clearTimeout(timer);
  }, [loadingFor]);

  if (!cursor)
    return (
      <Text style={styles.hint}>
        Les messages plus anciens sont dans le terminal.
      </Text>
    );
  const loading = loadingFor === cursor;
  return (
    <View style={styles.wrap}>
      <Pressable
        disabled={loading}
        onPress={() => {
          tap();
          setLoadingFor(cursor);
          onLoad();
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <SymbolView name="clock.arrow.circlepath" size={13} tintColor={C.dim} />
        <Text style={styles.label}>
          {loading ? "Chargement…" : "Charger les messages plus anciens"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingBottom: 14 },
  hint: {
    color: C.mute,
    fontSize: 12,
    textAlign: "center",
    paddingBottom: 14,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pressed: { backgroundColor: C.raised },
  label: { color: C.dim, fontSize: T.small },
});
