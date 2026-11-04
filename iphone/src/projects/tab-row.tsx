import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Swipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { RemoteTab } from "@/lib/remoteSnapshot";
import { act } from "~/remote/connection";
import { showFailure } from "~/ui/notice";
import { tap, tick } from "~/ui/haptics";
import { AccountChip, BadgeDot } from "~/ui/status-dots";

/** The row whose « Supprimer » shows: one at a time, as in Mail. */
let openRow: SwipeableMethods | null = null;

/** Hides the shown « Supprimer », if any (a scroll, a tap elsewhere). */
export function closeOpenRow(): boolean {
  if (!openRow) return false;
  openRow.close();
  openRow = null;
  return true;
}

/**
 * One tab of the projects list: a tap opens it, a swipe to the left shows
 * « Supprimer » at its right, which closes it on the PC (Alexis's ask of
 * 04/11/2026). The row goes at once, back if the PC refuses.
 */
export function TabRow({ tab }: { tab: RemoteTab }) {
  const swipeable = useRef<SwipeableMethods>(null);
  const [closing, setClosing] = useState(false);

  // Gone while open (tab closed on the PC, project moved to « Actifs »):
  // left pointing at it, the next tap on any row would only "hide" it.
  useEffect(() => {
    const methods = swipeable.current;
    return () => {
      if (openRow === methods) openRow = null;
    };
  }, []);

  const remove = async () => {
    tap();
    openRow = null;
    setClosing(true);
    try {
      await act({ kind: "closeTab", tabId: tab.id });
    } catch (e) {
      setClosing(false);
      showFailure(
        `Onglet non supprimé : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  if (closing) return null;
  return (
    <Swipeable
      ref={swipeable}
      friction={1.5}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableWillOpen={() => {
        if (openRow && openRow !== swipeable.current) openRow.close();
        openRow = swipeable.current;
      }}
      onSwipeableWillClose={() => {
        if (openRow === swipeable.current) openRow = null;
      }}
      renderRightActions={() => (
        <Pressable
          accessibilityLabel={`Supprimer l’onglet ${tab.title}`}
          onPress={() => void remove()}
          style={({ pressed }) => [
            styles.delete,
            pressed && styles.deletePressed,
          ]}
        >
          <Text style={styles.deleteText}>Supprimer</Text>
        </Pressable>
      )}
    >
      <Pressable
        onPress={() => {
          // A row's « Supprimer » shown: the tap hides it, as in Mail.
          if (closeOpenRow()) return;
          tick();
          router.push({ pathname: "/tab/[id]", params: { id: tab.id } });
        }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.separator} />
        <Text style={styles.title} numberOfLines={1}>
          {tab.title}
        </Text>
        <AccountChip account={tab.account} />
        {tab.panes.length > 1 && (
          <Text style={styles.paneCount}>{tab.panes.length}</Text>
        )}
        <BadgeDot badge={tab.badge} question={tab.question} />
        <SymbolView name="chevron.right" size={13} tintColor="#5a5a5e" />
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    paddingLeft: 38,
    paddingRight: 16,
    // Opaque: the red button waits under it until the swipe.
    backgroundColor: "#1c1c1e",
  },
  pressed: { backgroundColor: "#2c2c2e" },
  separator: {
    position: "absolute",
    top: 0,
    left: 38,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#38383a",
  },
  title: { flex: 1, color: "#ffffff", fontSize: 15 },
  paneCount: { color: "#8e8e93", fontSize: 12 },
  delete: {
    width: 96,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ff453a",
  },
  deletePressed: { backgroundColor: "#d63a31" },
  deleteText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
});
