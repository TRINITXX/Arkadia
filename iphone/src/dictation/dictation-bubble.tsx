import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

const BARS = 22;

interface DictationBubbleProps {
  transcript: string;
  level: number;
  stopping: boolean;
  onCancel: () => void;
  onWrite: () => void;
}

/**
 * The words being said, live, above the keys (choice A of 25/10/2026). They
 * reach Claude's prompt only on « Écrire » (or Entrée): written as they come,
 * each revision would be a burst Claude reads as a paste.
 */
export function DictationBubble({
  transcript,
  level,
  stopping,
  onCancel,
  onWrite,
}: DictationBubbleProps) {
  // The last levels, newest on the right: a waveform that moves with the voice.
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const latest = useRef(level);
  latest.current = level;
  useEffect(() => {
    const timer = setInterval(
      () => setLevels((l) => [...l.slice(1), latest.current]),
      120,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.bubble}>
      <Text style={[styles.live, !transcript && styles.hint]}>
        {transcript || "Parle, j’écris…"}
      </Text>
      <View style={styles.row}>
        <View style={styles.wave}>
          {levels.map((l, i) => (
            <View key={i} style={[styles.bar, { height: 4 + l * 22 }]} />
          ))}
        </View>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <SymbolView name="xmark" size={13} tintColor="#ffffff" />
          <Text style={styles.label}>Annuler</Text>
        </Pressable>
        <Pressable
          onPress={onWrite}
          disabled={stopping}
          style={({ pressed }) => [
            styles.button,
            styles.go,
            (pressed || stopping) && styles.pressed,
          ]}
        >
          <SymbolView name="checkmark" size={13} tintColor="#ffffff" />
          <Text style={styles.label}>Écrire</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 22,
    backgroundColor: "#2c2c2e",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  live: { color: "#ffffff", fontSize: 16, lineHeight: 22 },
  hint: { color: "#8e8e93" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  wave: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 26,
  },
  bar: { width: 3, borderRadius: 2, backgroundColor: "#ff453a" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  go: { backgroundColor: "#0a84ff" },
  pressed: { opacity: 0.6 },
  label: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
});
