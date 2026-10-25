import { StyleSheet, Text, View } from "react-native";
import { useTerminalStats } from "~/terminal/stats";

const ms = (value: number | null) => (value === null ? "…" : `${value} ms`);

/** The prototype's measures, in a corner of the terminal. */
export function StatsBadge() {
  const s = useTerminalStats();
  return (
    <View pointerEvents="none" style={styles.badge}>
      <Text style={styles.text}>
        {s.fps} img/s · écho {ms(s.echoMs)}
      </Text>
      <Text style={styles.text}>
        réseau {ms(s.networkMs)} · affichage {ms(s.displayMs)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(44,44,46,0.85)",
  },
  text: {
    color: "#ebebf5",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
});
