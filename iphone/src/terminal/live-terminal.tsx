import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderHandlers,
  type HostInstance,
  type LayoutChangeEvent,
  type TextLayoutEvent,
} from "react-native";
import { footerRowCount } from "@/lib/terminalChrome";
import { useWatchedFrame, type Status } from "~/remote/connection";
import { LINE_HEIGHT } from "~/terminal/metrics";
import { StatsBadge } from "~/terminal/stats-badge";
import { TerminalGrid } from "~/terminal/terminal-grid";
import type { RenderPayload, TerminalPalette } from "@/types";

interface LiveTerminalProps {
  paneId: string | null;
  status: Status;
  palette: TerminalPalette;
  areaRef: RefObject<HostInstance | null>;
  gestures: GestureResponderHandlers;
  onAreaLayout: (e: LayoutChangeEvent) => void;
  onRulerLayout: (e: TextLayoutEvent) => void;
  reclaim: (frame: RenderPayload | null) => void;
  /**
   * The message view, over the terminal down to its footer (prompt box,
   * Claude's questions), which stays live below it. Not a child of the grid:
   * its touches must not reach the terminal.
   */
  overlay: ReactNode;
}

/**
 * The only part of the screen that follows the pane's frames: the header,
 * its menus and the keys around it must not redraw 30 times a second.
 */
export function LiveTerminal({
  paneId,
  status,
  palette,
  areaRef,
  gestures,
  onAreaLayout,
  onRulerLayout,
  reclaim,
  overlay,
}: LiveTerminalProps) {
  const frame = useWatchedFrame();
  const screen = frame?.session_id === paneId ? frame : null;

  // The pane may carry another screen's size when it opens or after a
  // reconnect: the first frame tells, take it to this screen.
  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false;
  }, [paneId, status]);
  useEffect(() => {
    if (!screen || fitted.current) return;
    fitted.current = true;
    reclaim(screen);
  }, [screen, reclaim]);

  // Sized from the top, like the rows, so it ends above the footer even when
  // the PTY still has another screen's size.
  const footer = footerRowCount(screen);
  const overlaySize = screen
    ? { height: Math.max(0, screen.rows - footer - 1) * LINE_HEIGHT }
    : { bottom: (footer + 1) * LINE_HEIGHT };

  return (
    <View style={styles.wrap}>
      <TerminalGrid
        areaRef={areaRef}
        screen={screen}
        palette={palette}
        gestures={gestures}
        onAreaLayout={onAreaLayout}
        onRulerLayout={onRulerLayout}
      />
      {overlay && (
        <View
          style={[styles.overlay, { backgroundColor: palette.bg }, overlaySize]}
        >
          {overlay}
        </View>
      )}
      <StatsBadge />
      {status !== "open" && (
        <View pointerEvents="none" style={styles.notice}>
          <Text style={styles.noticeText}>
            {status === "lost" ? "Reconnexion…" : "Connexion…"}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0 },
  notice: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "rgba(255,159,10,0.9)",
  },
  noticeText: { color: "#000000", fontSize: 13, fontWeight: "600" },
});
