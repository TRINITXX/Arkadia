import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Crash } from "~/errors/crash-store";
import { success, tap } from "~/ui/haptics";
import { showFailure, showNotice } from "~/ui/notice";

/** Stack lines shown: the rest is in the copied report. */
const STACK_LINES = 14;

/**
 * An error the app caught instead of closing: what it says, the start of its
 * stack, and the report to copy and paste to Claude.
 */
export function CrashCard({
  title,
  crash,
  onRetry,
  onRelaunch,
  onClose,
}: {
  title: string;
  crash: Crash;
  onRetry?: () => void;
  onRelaunch?: () => void;
  onClose?: () => void;
}) {
  const stack = crash.stack.split("\n").slice(0, STACK_LINES).join("\n");
  const copy = () =>
    void Clipboard.setStringAsync(crash.report)
      .then(() => {
        success();
        showNotice("Erreur copiée");
      })
      .catch(() => showFailure("Copie impossible"));
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message} selectable>
        {crash.message}
      </Text>
      {stack ? (
        <ScrollView style={styles.stackBox}>
          <Text style={styles.stack} selectable>
            {stack}
          </Text>
        </ScrollView>
      ) : null}
      <View style={styles.buttons}>
        <Button label="Copier l’erreur" onPress={copy} strong feel={false} />
        {onRetry && <Button label="Réessayer" onPress={onRetry} />}
        {onRelaunch && <Button label="Relancer l’app" onPress={onRelaunch} />}
        {onClose && <Button label="Fermer" onPress={onClose} />}
      </View>
    </View>
  );
}

function Button({
  label,
  onPress,
  strong = false,
  feel = true,
}: {
  label: string;
  onPress: () => void;
  strong?: boolean;
  /** Off: its action says how it went (a copy). */
  feel?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        if (feel) tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        strong && styles.buttonStrong,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, strong && styles.buttonTextStrong]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#1c1c1e",
  },
  title: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  message: { color: "#ff6961", fontSize: 14 },
  stackBox: { maxHeight: 180 },
  stack: {
    color: "#8e8e93",
    fontSize: 11,
    fontFamily: "Menlo",
  },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#2c2c2e",
  },
  buttonStrong: { backgroundColor: "#0a84ff" },
  pressed: { opacity: 0.6 },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "500" },
  buttonTextStrong: { fontWeight: "600" },
});
