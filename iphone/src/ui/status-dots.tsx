import { Animated, StyleSheet, Text, View } from "react-native";
import type { AccountMark } from "@/lib/accounts";
import type { RemoteBadge } from "@/lib/remoteSnapshot";
import {
  accountShortLabel,
  badgeColor,
  badgeRings,
  type BadgeRing,
} from "~/remote/snapshot";
import { useBadgePulse } from "~/ui/use-badge-pulse";

const DOT = 9;
// The desktop's rings (AgentBadge's RING_LAYERS), innermost first: 1.5px
// wide, each after a 1.5px transparent gap, ending this far past the dot.
const RING_WIDTH = 1.5;
const RING_REACH = [3, 6, 9];
// Tailwind's emerald-400, blue-400 and purple-400, as on the desktop.
const RING_COLORS: Record<BadgeRing, string> = {
  question: "#34d399",
  shell: "#60a5fa",
  artifact: "#c084fc",
};

/** The desktop's agent badge: amber = Claude works (and pulses), green = it
 *  waits for you. Rings: green = its questions wait, blue = a shell runs while
 *  it waits, violet = an artifact is open (choice of 02/11/2026). */
export function BadgeDot({
  badge,
  question,
}: {
  badge: RemoteBadge;
  question: boolean;
}) {
  const color = badgeColor(badge);
  const busy = badge?.startsWith("busy") ?? false;
  const halo = useBadgePulse(busy, DOT);
  if (!color) return null;
  const rings = badgeRings(badge, question);
  // The box holds the outermost ring, so no ring is clipped or runs over the
  // text beside it. The pulse fades as it spreads and overflows, as on the
  // desktop: room for it would move the row at every turn.
  const box = DOT + 2 * (RING_REACH[rings.length - 1] ?? 0);
  const at = (size: number) => ({
    left: (box - size) / 2,
    top: (box - size) / 2,
    width: size,
    height: size,
    borderRadius: size / 2,
  });
  return (
    <View style={{ width: box, height: box }}>
      {busy && (
        <Animated.View
          style={[styles.halo, at(DOT), { backgroundColor: color }, halo]}
        />
      )}
      <View
        style={[
          styles.badge,
          at(DOT),
          { backgroundColor: color, shadowColor: color },
        ]}
      />
      {rings.map((ring, layer) => (
        <View
          key={ring}
          style={[
            styles.ring,
            at(DOT + 2 * RING_REACH[layer]),
            { borderColor: RING_COLORS[ring] },
          ]}
        />
      ))}
    </View>
  );
}

/** The Claude account a tab runs on, by its number. */
export function AccountChip({ account }: { account: AccountMark | null }) {
  if (!account) return null;
  return (
    <Text style={[styles.account, { backgroundColor: account.color }]}>
      {accountShortLabel(account.label)}
    </Text>
  );
}

const styles = StyleSheet.create({
  halo: { position: "absolute" },
  badge: {
    position: "absolute",
    shadowOpacity: 0.6,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  ring: { position: "absolute", borderWidth: RING_WIDTH },
  account: {
    overflow: "hidden",
    borderRadius: 5,
    paddingHorizontal: 5,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    color: "#000000",
  },
});
