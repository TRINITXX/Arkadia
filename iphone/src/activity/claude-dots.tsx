import { Circle, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";
/** The rows the PC used to push: state (`w` | `b` | `i`), project, tab. */
export interface ClaudeDotsProps {
  tabs: { s: string; p: string; t: string }[];
}

/**
 * Kept only so `useEndLiveActivity` finds and ends one an earlier version
 * left running: the app no longer starts it (04/11/2026).
 *
 * The Lock Screen and Dynamic Island: a row per listed tab, in the
 * projects' order, its dot (green: Claude waits for you, orange: it works)
 * then its project and tab (Alexis's request of 25/10/2026). The island
 * shows a single dot (choice of 02/11/2026), the full list only when
 * pressed. Runs in the widget extension: no import or constant from outside
 * this function.
 */
function ClaudeDots(props: ClaudeDotsProps) {
  "widget";
  const color = (s: string) =>
    s === "w" ? "#30d158" : s === "b" ? "#ff9f0a" : "#8e8e93";
  const dot = (s: string, size: number, key?: number) => (
    <Circle
      key={key}
      modifiers={[
        foregroundStyle(color(s)),
        frame({ width: size, height: size }),
      ]}
    />
  );
  const list = (max: number) => {
    const shown = props.tabs.slice(0, max);
    const more = props.tabs.length - shown.length;
    return (
      <VStack alignment="leading" spacing={7}>
        {shown.map((tab, i) => (
          <HStack key={i} spacing={8}>
            {dot(tab.s, 10)}
            <Text
              modifiers={[font({ size: 14, weight: "semibold" }), lineLimit(1)]}
            >
              {tab.p}
            </Text>
            <Text
              modifiers={[
                font({ size: 14 }),
                foregroundStyle("#aeaeb2"),
                lineLimit(1),
              ]}
            >
              {tab.t}
            </Text>
            <Spacer />
          </HStack>
        ))}
        {more > 0 && (
          <Text modifiers={[font({ size: 13 }), foregroundStyle("#8e8e93")]}>
            {`+${more}`}
          </Text>
        )}
      </VStack>
    );
  };
  // The island shows one dot: green as soon as a tab waits for you.
  const first = props.tabs.some((t) => t.s === "w")
    ? "w"
    : (props.tabs[0]?.s ?? "i");
  return {
    banner: (
      <HStack alignment="top" spacing={12} modifiers={[padding({ all: 16 })]}>
        <Image systemName="terminal.fill" color="#ffffff" />
        {list(4)}
      </HStack>
    ),
    compactLeading: dot(first, 8),
    minimal: dot(first, 10),
    expandedBottom: list(3),
  };
}

export const claudeDots = createLiveActivity<ClaudeDotsProps>(
  "ClaudeDots",
  ClaudeDots,
);
