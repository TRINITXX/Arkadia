import { useEffect, useMemo, type RefObject } from "react";
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderHandlers,
  type HostInstance,
  type LayoutChangeEvent,
  type TextLayoutEvent,
} from "react-native";
import { watchedFrameReceivedAt } from "~/remote/connection";
import { ROW_STYLE, PAD_X } from "~/terminal/metrics";
import { noteDisplayed } from "~/terminal/stats";
import { TerminalRow } from "~/terminal/terminal-row";
import { RULER } from "~/terminal/use-pane-fit";
import type { RenderPayload, TerminalPalette } from "@/types";

interface TerminalGridProps {
  areaRef: RefObject<HostInstance | null>;
  screen: RenderPayload | null;
  palette: TerminalPalette;
  gestures: GestureResponderHandlers;
  onAreaLayout: (e: LayoutChangeEvent) => void;
  onRulerLayout: (e: TextLayoutEvent) => void;
}

/** The pane's rows as native text; a row redraws only when it changed. */
export function TerminalGrid({
  areaRef,
  screen,
  palette,
  gestures,
  onAreaLayout,
  onRulerLayout,
}: TerminalGridProps) {
  const rowStyle = useMemo(
    () => ({ ...ROW_STYLE, color: palette.fg }),
    [palette],
  );
  const signatures = useMemo(
    () => screen?.lines.map((runs) => JSON.stringify(runs)) ?? [],
    [screen],
  );

  // Drawn: how long since the frame arrived (the display's share of the echo).
  useEffect(() => {
    if (!screen) return;
    const receivedAt = watchedFrameReceivedAt();
    requestAnimationFrame(() => noteDisplayed(receivedAt));
  }, [screen]);

  return (
    <View
      ref={areaRef}
      style={[styles.area, { backgroundColor: palette.bg }]}
      onLayout={onAreaLayout}
      {...gestures}
    >
      <Text style={[ROW_STYLE, styles.ruler]} onTextLayout={onRulerLayout}>
        {RULER}
      </Text>
      {screen ? (
        screen.lines.map((runs, row) => (
          <TerminalRow
            key={row}
            runs={runs}
            signature={signatures[row]}
            cursorCol={
              row === screen.cursor_row && screen.cursor_visible
                ? screen.cursor_col
                : null
            }
            palette={palette}
            style={rowStyle}
          />
        ))
      ) : (
        <Text style={styles.loading}>Chargement…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, overflow: "hidden", paddingHorizontal: PAD_X },
  // Wide enough never to wrap: its first line is the measure.
  ruler: { position: "absolute", opacity: 0, left: 0, top: 0, width: 2000 },
  loading: { color: "#8e8e93", paddingTop: 12, fontSize: 15 },
});
