import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import * as Updates from "expo-updates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CrashCard } from "~/errors/crash-card";
import {
  crashOf,
  dismissCrash,
  useCrash,
  useCrashScreenUp,
  useCrashScreensUp,
} from "~/errors/crash-store";
import { forgetLastTab } from "~/errors/opening-mark";

/** A recorded error this recent is the one the screen fell over. */
const CAUSE_MS = 5000;

/** A fresh start on Projets: the broken tab is not reopened. */
function relaunch() {
  forgetLastTab();
  void Updates.reloadAsync().catch(() => {});
}

/**
 * A route's `ErrorBoundary` (Expo Router): a screen that throws shows its
 * error here, the app stays up. A module that failed to load surfaces here
 * as a later error of Expo Router's: the one the global handler recorded is
 * the cause, shown first. On the root layout nothing else is left to go
 * back to: « Relancer l'app » starts again on Projets.
 */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const recorded = useCrash();
  const own = useMemo(() => crashOf(error, "screen"), [error]);
  useCrashScreenUp();
  useEffect(() => forgetLastTab(), []);
  return (
    <View style={styles.screen}>
      <CrashCard
        title="Cet écran n’a pas pu s’afficher"
        crash={recorded && own.at - recorded.at < CAUSE_MS ? recorded : own}
        onRetry={() => {
          dismissCrash();
          void retry();
        }}
        onRelaunch={relaunch}
      />
    </View>
  );
}

/**
 * An error caught outside rendering, or a tab not reopened: over the app,
 * under Face ID's lock screen. An error screen up shows it already.
 */
export function CrashOverlay() {
  const crash = useCrash();
  const screenUp = useCrashScreensUp();
  const insets = useSafeAreaInsets();
  if (!crash || screenUp) return null;
  return (
    <View style={[styles.overlay, { bottom: insets.bottom + 12 }]}>
      <CrashCard
        title={
          crash.where === "native" ? "Onglet non rouvert" : "Erreur dans l’app"
        }
        crash={crash}
        onClose={dismissCrash}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
    backgroundColor: "#000000",
  },
  // Under the lock screen's 100.
  overlay: { position: "absolute", left: 12, right: 12, zIndex: 90 },
});
