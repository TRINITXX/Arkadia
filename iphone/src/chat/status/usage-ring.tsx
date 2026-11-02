import { StyleSheet, Text, View } from "react-native";
import { C } from "~/chat/chat-theme";

/** The desktop's ring (`chat-ring.tsx`, 26 px), a touch smaller here. */
const SIZE = 24;
const STROKE = 3;
const HALF = SIZE / 2;

/** The desktop's track, figure and amber (`.chat-ring`). */
const TRACK = "#2f3238";
const FIGURE = "#d4d4d8";
export const HOT_INK = "#fcd34d";

/**
 * A gauge of the status row: a ring that fills clockwise from the top up to
 * `percent`, its figure inside, amber once `hot` (mockup A of 02/11/2026).
 * The app has no SVG: two half discs, each turned about the ring's centre
 * inside the half that clips it, under a hole of the input's colour.
 */
export function UsageRing({
  percent,
  hot,
  backdrop = C.raised,
}: {
  percent: number;
  hot: boolean;
  /** What the ring sits on, for its hole: the input's card by default. */
  backdrop?: string;
}) {
  const turn = (Math.min(100, Math.max(0, percent)) / 100) * 360;
  const fill = { backgroundColor: hot ? HOT_INK : C.dim };
  return (
    <View style={styles.ring}>
      {turn > 0 && (
        <View style={[styles.clip, styles.rightHalf]}>
          <View
            style={[
              styles.disc,
              styles.fromLeft,
              fill,
              { transform: [{ rotate: `${Math.min(turn, 180)}deg` }] },
            ]}
          />
        </View>
      )}
      {turn > 180 && (
        <View style={[styles.clip, styles.leftHalf]}>
          <View
            style={[
              styles.disc,
              styles.fromRight,
              fill,
              { transform: [{ rotate: `${turn - 180}deg` }] },
            ]}
          />
        </View>
      )}
      <View style={[styles.hole, { backgroundColor: backdrop }]}>
        <Text style={[styles.figure, hot && styles.hot]}>
          {Math.round(percent)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: HALF,
    backgroundColor: TRACK,
  },
  clip: {
    position: "absolute",
    top: 0,
    width: HALF,
    height: SIZE,
    overflow: "hidden",
  },
  rightHalf: { left: HALF },
  leftHalf: { left: 0 },
  disc: { position: "absolute", top: 0, width: HALF, height: SIZE },
  /** The left half disc, just outside the right half: turned in, it fills 0-180°. */
  fromLeft: {
    left: -HALF,
    borderTopLeftRadius: HALF,
    borderBottomLeftRadius: HALF,
    transformOrigin: "right center",
  },
  /** The right half disc, just outside the left half: turned in, 180-360°. */
  fromRight: {
    left: HALF,
    borderTopRightRadius: HALF,
    borderBottomRightRadius: HALF,
    transformOrigin: "left center",
  },
  hole: {
    position: "absolute",
    top: STROKE,
    left: STROKE,
    right: STROKE,
    bottom: STROKE,
    borderRadius: HALF - STROKE,
    alignItems: "center",
    justifyContent: "center",
  },
  figure: {
    color: FIGURE,
    fontSize: 9,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  hot: { color: HOT_INK },
});
