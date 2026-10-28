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
import { footerRowCount, isJumpPill } from "@/lib/terminalChrome";
import { send, useWatchedFrame, type Status } from "~/remote/connection";
import { LINE_HEIGHT } from "~/terminal/metrics";
import { TerminalGrid } from "~/terminal/terminal-grid";
import type { RenderPayload, TerminalPalette } from "@/types";

interface LiveTerminalProps {
  paneId: string | null;
  /** Claude Code runs in the pane: its "Jump to bottom" pill can be trusted. */
  claude: boolean;
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
  claude,
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
  // Arriving on the pane, not reconnecting: a drop or a return to the app
  // must not lose the place Alexis scrolled to.
  const arrived = useRef(false);
  useEffect(() => {
    arrived.current = false;
  }, [paneId]);
  useEffect(() => {
    fitted.current = false;
  }, [paneId, status]);
  useEffect(() => {
    if (!screen || fitted.current) return;
    fitted.current = true;
    reclaim(screen);
    if (arrived.current || !paneId) return;
    arrived.current = true;
    // The latest messages, not where the pane was left. The offset counts
    // only off the alt screen (`scroll_max` 0 there), and the pill only in
    // Claude Code: elsewhere ctrl+End would reach vim or less.
    const scrolledBack = screen.scroll_max > 0 && screen.scroll_offset > 0;
    if (scrolledBack || (claude && screen.lines.some(isJumpPill)))
      send({ t: "bottom", pane: paneId });
  }, [screen, reclaim, paneId, claude]);

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
