import { Pressable, StyleSheet } from "react-native";
import { SymbolView } from "expo-symbols";
import { A } from "~/chat/asks/ask-colors";
import { C } from "~/chat/chat-theme";
import type { AskDictation } from "~/chat/asks/use-ask-dictation";

/**
 * The mic left of an own-words field (the desktop sheet's): listens for that
 * field, red while it does; a second tap writes the words in. Off while
 * another field of the panel listens.
 */
export function AskMic({
  dictation,
  id,
  onText,
}: {
  dictation: AskDictation;
  /** The field it dictates into. */
  id: string;
  onText: (text: string) => void;
}) {
  const listening = dictation.field === id;
  const busy = dictation.phase !== "idle" && !listening;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? "Arrêter la dictée" : "Dicter ici"}
      disabled={busy || dictation.phase === "stopping"}
      hitSlop={4}
      onPress={() =>
        listening ? void dictation.writeOut() : dictation.listen(id, onText)
      }
      style={({ pressed }) => [
        styles.mic,
        listening && styles.rec,
        (pressed || busy) && styles.dim,
      ]}
    >
      <SymbolView
        name={listening ? "stop.fill" : "mic"}
        size={15}
        tintColor={listening ? "#ffffff" : C.ink}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mic: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: A.button,
  },
  rec: { backgroundColor: A.recording },
  dim: { opacity: 0.5 },
});
