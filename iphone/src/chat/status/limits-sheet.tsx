import { StyleSheet, Text, View } from "react-native";
import { resetLabel } from "@/lib/chat/chatLabels";
import type { WindowRing } from "@/lib/chat/chatStatus";
import { C, T } from "~/chat/chat-theme";
import { FeedSheet } from "~/chat/feed/feed-sheet";
import { HOT_INK, UsageRing } from "~/chat/status/usage-ring";

/** « lun. 15:30 »: when a window starts again. */
const clock = (epochSeconds: number) =>
  new Date(epochSeconds * 1000).toLocaleString("fr-FR", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The plan's two windows behind the session and week rings: how much is
 * used, when each starts again (the desktop's ring titles and countdown).
 * A window past its reset starts with the next request: no time known yet.
 */
export function LimitsSheet({
  visible,
  fiveHour,
  sevenDay,
  now,
  onClose,
}: {
  visible: boolean;
  fiveHour: WindowRing | null;
  sevenDay: WindowRing | null;
  now: number;
  onClose: () => void;
}) {
  const windows = [
    { label: "Session de 5 h", ring: fiveHour },
    { label: "Semaine", ring: sevenDay },
  ];
  return (
    <FeedSheet
      visible={visible}
      title="Utilisation du compte"
      icon="gauge.medium"
      onClose={onClose}
    >
      {windows.map(({ label, ring }) => {
        const left =
          ring?.resetsAt !== undefined ? resetLabel(ring.resetsAt, now) : null;
        return (
          <View key={label} style={styles.window}>
            {ring ? (
              <UsageRing
                percent={ring.percent}
                hot={ring.hot}
                backdrop={C.bg}
              />
            ) : (
              <View style={styles.none} />
            )}
            <View style={styles.text}>
              <Text style={styles.label}>
                {label}
                {ring && (
                  <Text style={[styles.used, ring.hot && styles.hot]}>
                    {` · ${Math.round(ring.percent)} % utilisé`}
                  </Text>
                )}
              </Text>
              <Text style={styles.reset}>
                {!ring
                  ? "Pas encore connue"
                  : left && ring.resetsAt !== undefined
                    ? `Reset dans ${left} (${clock(ring.resetsAt)})`
                    : "Repart à la prochaine requête"}
              </Text>
            </View>
          </View>
        );
      })}
    </FeedSheet>
  );
}

const styles = StyleSheet.create({
  window: { flexDirection: "row", alignItems: "center", gap: 12 },
  none: { width: 24, height: 24 },
  text: { flex: 1, gap: 2 },
  label: { color: C.ink, fontSize: T.body, fontWeight: "600" },
  used: { color: C.dim, fontWeight: "400" },
  hot: { color: HOT_INK },
  reset: { color: C.mute, fontSize: T.small, fontVariant: ["tabular-nums"] },
});
