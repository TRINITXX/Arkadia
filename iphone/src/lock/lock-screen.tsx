import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

/** Covers the app until Face ID passes; the button asks again. */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  return (
    <View style={styles.screen}>
      <SymbolView name="lock.fill" size={44} tintColor="#8e8e93" />
      <Text style={styles.title}>Arkadia verrouillé</Text>
      <Pressable
        onPress={onUnlock}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <SymbolView name="faceid" size={20} tintColor="#ffffff" />
        <Text style={styles.buttonText}>Déverrouiller</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  title: { color: "#ffffff", fontSize: 22, fontWeight: "600" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 50,
    paddingHorizontal: 26,
    borderRadius: 25,
    backgroundColor: "#0a84ff",
  },
  pressed: { opacity: 0.7 },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
});
