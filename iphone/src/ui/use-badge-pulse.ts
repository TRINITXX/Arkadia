import { useEffect, useMemo } from "react";
import { Animated, Easing, useAnimatedValue } from "react-native";

// The desktop's agent-badge-pulse (src/styles/app.css): every 1.4 s a halo of
// the dot's color grows 7px past it and fades from 0.7 to nothing over the
// first 60% (ease-out), then rests until the next beat.
const PULSE_MS = 1400;
const PULSE_REACH = 7;
const easeOut = Easing.bezier(0, 0, 0.58, 1);
const beat = (t: number) => (t < 0.6 ? easeOut(t / 0.6) : 1);

/** The halo's style for a dot of `size`, beating while `busy`. The loop runs
 *  on the native driver, and only a change of `busy` restarts it. */
export function useBadgePulse(busy: boolean, size: number) {
  const pulse = useAnimatedValue(0);
  useEffect(() => {
    if (!busy) return;
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: PULSE_MS,
        easing: beat,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, pulse]);
  return useMemo(
    () => ({
      opacity: pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.7, 0],
      }),
      transform: [
        {
          scale: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [1, (size + 2 * PULSE_REACH) / size],
          }),
        },
      ],
    }),
    [pulse, size],
  );
}
